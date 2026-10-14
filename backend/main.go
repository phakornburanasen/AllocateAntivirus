package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "github.com/denisenkom/go-mssqldb"
	"github.com/go-ldap/ldap/v3"
)

type app struct {
	db          *sql.DB
	vpnDB       *sql.DB
	uploadDir   string
	uploadURL   string
	imgBinary   bool
	allowedCORS string
	auth        authConfig
}

type authConfig struct {
	vpnLoginDSN string
	ldapURL     string
	ldapDomain  string
	baseDN      string
	bindPattern string
	startTLS    bool
	insecureTLS bool
	tlsMin      uint16
	tlsMax      uint16
	timeout     time.Duration
	jwtSecret   string
	jwtTTL      time.Duration
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Success     bool   `json:"success"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Role        string `json:"role,omitempty"`
	Token       string `json:"token,omitempty"`
	ExpiresAt   int64  `json:"expiresAt,omitempty"`
	Message     string `json:"message,omitempty"`
	Error       string `json:"error,omitempty"`
}

type assetRecord struct {
	ID        int     `json:"id"`
	Hostname  *string `json:"hostname"`
	IPAddress *string `json:"ip_address"`
	Username  *string `json:"username"`
	Users     *string `json:"users"`
	Note      *string `json:"note"`
	Dep       *string `json:"dep"`
	ImagePNG  *string `json:"img_png"`
	AssetNA   *string `json:"asset_na"`
	Active    string  `json:"Active"`
}

type imageInfo struct {
	ImagesCount  int      `json:"images_count"`
	ImagesAdded  int      `json:"images_added"`
	UploadErrors []string `json:"upload_errors"`
}

type mutationResponse struct {
	Success bool      `json:"success"`
	Message string    `json:"message"`
	Images  imageInfo `json:"images,omitempty"`
}

var (
	errAuthNotReady       = errors.New("login service is not configured")
	errInvalidCredentials = errors.New("username or password is invalid")
	errNoPermission       = errors.New("บัญชี AD นี้ไม่มีสิทธิ์เข้าใช้งานระบบ")
)

func main() {
	wd, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}

	appRoot := getenv("APP_ROOT", filepath.Clean(filepath.Join(wd, "..")))
	exeDir := executableDir()
	loadEnvFiles(
		filepath.Join(exeDir, ".env"),
		filepath.Join(appRoot, ".env"),
		filepath.Join(appRoot, "backend", ".env"),
		filepath.Join(wd, ".env"),
		filepath.FromSlash("/opt/AllocateAntivirus/.env"),
		filepath.FromSlash("/opt/DOCUMENT/backend/.env"),
		filepath.FromSlash("/var/www/AllocateAntivirus/.env"),
		filepath.FromSlash("/var/www/html/AllocateAntivirus/.env"),
		filepath.FromSlash("/var/www/DOCUMENT/backend/.env"),
		filepath.FromSlash("/var/www/html/DOCUMENT/backend/.env"),
		getenv("DOCUMENT_ENV_FILE", filepath.FromSlash("C:/Dev/DOCUMENT/backend/.env")),
	)

	uploadDir := getenv("UPLOAD_DIR", filepath.Join(appRoot, "uploads", "imgs"))
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatalf("create upload dir: %v", err)
	}

	db, err := sql.Open("sqlserver", buildDSN())
	if err != nil {
		log.Fatal(err)
	}
	dbCtx, dbCancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer dbCancel()
	if err := db.PingContext(dbCtx); err != nil {
		log.Fatalf("connect asset database: %v", err)
	}

	authCfg := loadAuthConfig()
	var vpnDB *sql.DB
	if strings.TrimSpace(authCfg.vpnLoginDSN) != "" {
		vpnDB, err = sql.Open("sqlserver", authCfg.vpnLoginDSN)
		if err != nil {
			log.Fatalf("open vpn login database: %v", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if err := vpnDB.PingContext(ctx); err != nil {
			log.Fatalf("connect vpn login database: %v", err)
		}
	} else {
		log.Print("VPN_LOGIN_DSN is not set; login endpoint will return service unavailable")
	}

	a := &app{
		db:          db,
		vpnDB:       vpnDB,
		uploadDir:   uploadDir,
		uploadURL:   strings.Trim(getenv("UPLOAD_URL", "uploads/imgs/"), "/") + "/",
		allowedCORS: getenv("CORS_ORIGIN", "*"),
		auth:        authCfg,
	}
	a.imgBinary = a.detectImageColumnBinary(context.Background())

	mux := http.NewServeMux()
	uploadFiles := http.FileServer(http.Dir(filepath.Dir(uploadDir)))
	mux.HandleFunc("/health", a.withCORS(a.health))
	mux.HandleFunc("/api/health", a.withCORS(a.health))
	mux.HandleFunc("/api/AllocateAntivirus/health", a.withCORS(a.health))
	mux.HandleFunc("/login", a.withCORS(a.login))
	mux.HandleFunc("/api/login", a.withCORS(a.login))
	mux.HandleFunc("/api/AllocateAntivirus/login", a.withCORS(a.login))
	mux.HandleFunc("/api/AllocateAntivirus/assets", a.withCORS(a.assets))
	mux.HandleFunc("/api/AllocateAntivirus/uploads/", a.withCORS(http.StripPrefix("/api/AllocateAntivirus/uploads/", uploadFiles).ServeHTTP))
	mux.HandleFunc("/uploads/", a.withCORS(http.StripPrefix("/uploads/", uploadFiles).ServeHTTP))
	a.mountFrontend(mux, appRoot)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/AllocateAntivirus/", http.StatusFound)
	})

	addr := ":" + getenv("PORT", "10101")
	log.Printf("AllocateAntivirus backend listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func (a *app) mountFrontend(mux *http.ServeMux, appRoot string) {
	frontendDir := getenv("FRONTEND_DIR", filepath.Join(appRoot, "frontend", "dist"))
	if stat, err := os.Stat(frontendDir); err != nil || !stat.IsDir() {
		return
	}

	fileServer := http.FileServer(http.Dir(frontendDir))
	mux.HandleFunc("/AllocateAntivirus/", func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, "/AllocateAntivirus/")
		if rel == "" {
			http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
			return
		}
		target := filepath.Join(frontendDir, filepath.FromSlash(rel))
		if stat, err := os.Stat(target); err == nil && !stat.IsDir() {
			http.StripPrefix("/AllocateAntivirus/", fileServer).ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
	})
}

func (a *app) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (a.allowedCORS == "*" || origin == a.allowedCORS) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func (a *app) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	var in loginRequest
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, loginResponse{Success: false, Error: "Invalid JSON data"})
		return
	}

	username := normalizeADUsername(in.Username)
	if username == "" || strings.TrimSpace(in.Password) == "" {
		writeJSON(w, http.StatusUnauthorized, loginResponse{Success: false, Error: "Username or password is invalid"})
		return
	}
	if len(username) > 50 {
		writeJSON(w, http.StatusBadRequest, loginResponse{Success: false, Error: "Username is too long"})
		return
	}

	displayName, err := a.authenticateAD(r.Context(), username, in.Password)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errInvalidCredentials) {
			status = http.StatusUnauthorized
		} else if errors.Is(err, errAuthNotReady) {
			status = http.StatusServiceUnavailable
		}
		writeJSON(w, status, loginResponse{Success: false, Error: err.Error()})
		return
	}

	role, err := a.checkLoginPermission(r.Context(), username)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errNoPermission) {
			status = http.StatusForbidden
		} else if errors.Is(err, errAuthNotReady) {
			status = http.StatusServiceUnavailable
		}
		writeJSON(w, status, loginResponse{Success: false, Error: err.Error()})
		return
	}

	token, expiresAt, err := a.issueLoginToken(username, displayName, role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, loginResponse{Success: false, Error: "Cannot create login session"})
		return
	}

	writeJSON(w, http.StatusOK, loginResponse{
		Success:     true,
		Username:    username,
		DisplayName: displayName,
		Role:        role,
		Token:       token,
		ExpiresAt:   expiresAt,
		Message:     "Login successful",
	})
}

func buildDSN() string {
	q := url.Values{}
	q.Set("database", getenv("DB_NAME", "SSO_Agent_tnlx"))
	q.Set("encrypt", getenv("DB_ENCRYPT", "disable"))
	q.Set("TrustServerCertificate", getenv("DB_TRUST_SERVER_CERTIFICATE", "true"))

	u := &url.URL{
		Scheme:   "sqlserver",
		User:     url.UserPassword(getenv("DB_USER", "sa"), getenv("DB_PASS", "Thanulux2569")),
		Host:     getenv("DB_SERVER", "10.0.32.165"),
		RawQuery: q.Encode(),
	}
	return u.String()
}

func (a *app) detectImageColumnBinary(ctx context.Context) bool {
	var dataType string
	err := a.db.QueryRowContext(ctx, `
SELECT DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'allocate_antivirus' AND COLUMN_NAME = 'img_png'`).Scan(&dataType)
	if err != nil {
		log.Printf("detect img_png column type: %v", err)
		return false
	}
	return strings.EqualFold(strings.TrimSpace(dataType), "varbinary")
}

func (a *app) assets(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.getAssets(w, r)
	case http.MethodPost:
		a.postAssets(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
	}
}

func (a *app) getAssets(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Query().Get("action") {
	case "get":
		a.getAsset(w, r)
	default:
		a.listAssets(w, r)
	}
}

func (a *app) listAssets(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `
SELECT id, hostname, ip_address, username, users, note, dep, img_png, asset_na, Active
FROM dbo.allocate_antivirus
ORDER BY id DESC`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	records := []assetRecord{}
	for rows.Next() {
		rec, err := scanAsset(rows)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		records = append(records, rec)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, records)
}

func (a *app) getAsset(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(r.URL.Query().Get("id"))
	if id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid ID"})
		return
	}

	row := a.db.QueryRowContext(r.Context(), `
SELECT id, hostname, ip_address, username, users, note, dep, img_png, asset_na, Active
FROM dbo.allocate_antivirus
WHERE id = @p1`, id)
	rec, err := scanAsset(row)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (a *app) postAssets(w http.ResponseWriter, r *http.Request) {
	if strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		var values map[string]string
		if err := json.NewDecoder(r.Body).Decode(&values); err != nil {
			writeJSON(w, http.StatusBadRequest, mutationResponse{Success: false, Message: "Invalid JSON data"})
			return
		}
		if values["action"] == "delete" {
			a.deleteAssetValues(w, r, values)
			return
		}
		a.saveAssetValues(w, r, values["action"], values, nil)
		return
	}

	if err := r.ParseMultipartForm(96 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, mutationResponse{Success: false, Message: "Invalid form data"})
		return
	}
	values := requestValues(r)
	if values["action"] == "delete" {
		a.deleteAssetValues(w, r, values)
		return
	}
	a.saveAssetValues(w, r, values["action"], values, r.MultipartForm)
}

func (a *app) saveAssetValues(w http.ResponseWriter, r *http.Request, action string, values map[string]string, multipartForm *multipart.Form) {
	id, _ := strconv.Atoi(values["id"])
	if action != "create" && action != "update" {
		writeJSON(w, http.StatusBadRequest, mutationResponse{Success: false, Message: "Invalid action"})
		return
	}

	existingImages := []string{}
	if id > 0 {
		images, err := a.assetImagePaths(r.Context(), id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusInternalServerError, mutationResponse{Success: false, Message: err.Error()})
			return
		}
		existingImages = images
	}

	removedImages := splitImages(values["removed_images"])
	a.removeImages(removedImages)
	existingImages = difference(existingImages, removedImages)

	newImages, uploadErrors := a.saveUploadedImages(multipartForm)
	allImages := append(existingImages, newImages...)
	if len(allImages) > 3 {
		allImages = allImages[:3]
	}

	imgValue := a.imageDBValue(strings.Join(allImages, ","))
	active := activeValue(values["Active"])
	imgInfo := imageInfo{ImagesCount: len(allImages), ImagesAdded: len(newImages), UploadErrors: uploadErrors}

	if action == "create" || (action == "update" && id == 0) {
		insertSQL := `
INSERT INTO dbo.allocate_antivirus (hostname, ip_address, username, users, note, dep, img_png, asset_na, Active)
VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9)`
		if a.imgBinary {
			insertSQL = `
INSERT INTO dbo.allocate_antivirus (hostname, ip_address, username, users, note, dep, img_png, asset_na, Active)
VALUES (@p1, @p2, @p3, @p4, @p5, @p6, CONVERT(varbinary(max), @p7), @p8, @p9)`
		}
		_, err := a.db.ExecContext(r.Context(), insertSQL,
			nullable(values["hostname"]), nullable(values["ip_address"]), nullable(values["username"]),
			nullable(values["users"]), nullable(values["note"]), nullable(values["dep"]), imgValue, nullable(values["asset_na"]), active)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, mutationResponse{Success: false, Message: "DB Error: " + err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, mutationResponse{Success: true, Message: "Asset created", Images: imgInfo})
		return
	}

	if id <= 0 {
		writeJSON(w, http.StatusBadRequest, mutationResponse{Success: false, Message: "Invalid ID"})
		return
	}
	updateSQL := `
UPDATE dbo.allocate_antivirus
SET hostname = @p1, ip_address = @p2, username = @p3, users = @p4, note = @p5, dep = @p6, img_png = @p7, asset_na = @p8, Active = @p9
WHERE id = @p10`
	if a.imgBinary {
		updateSQL = `
UPDATE dbo.allocate_antivirus
SET hostname = @p1, ip_address = @p2, username = @p3, users = @p4, note = @p5, dep = @p6, img_png = CONVERT(varbinary(max), @p7), asset_na = @p8, Active = @p9
WHERE id = @p10`
	}
	_, err := a.db.ExecContext(r.Context(), updateSQL,
		nullable(values["hostname"]), nullable(values["ip_address"]), nullable(values["username"]),
		nullable(values["users"]), nullable(values["note"]), nullable(values["dep"]), imgValue, nullable(values["asset_na"]), active, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, mutationResponse{Success: false, Message: "DB Error: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, mutationResponse{Success: true, Message: "Asset updated", Images: imgInfo})
}

func (a *app) deleteAssetValues(w http.ResponseWriter, r *http.Request, values map[string]string) {
	id, _ := strconv.Atoi(values["id"])
	if id <= 0 {
		writeJSON(w, http.StatusBadRequest, mutationResponse{Success: false, Message: "Invalid ID"})
		return
	}

	images, err := a.assetImagePaths(r.Context(), id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusInternalServerError, mutationResponse{Success: false, Message: err.Error()})
		return
	}
	a.removeImages(images)

	if _, err := a.db.ExecContext(r.Context(), "DELETE FROM dbo.allocate_antivirus WHERE id = @p1", id); err != nil {
		writeJSON(w, http.StatusInternalServerError, mutationResponse{Success: false, Message: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, mutationResponse{Success: true, Message: "Asset deleted"})
}

type scanner interface {
	Scan(dest ...any) error
}

func scanAsset(row scanner) (assetRecord, error) {
	var rec assetRecord
	var hostname, ipAddress, username, users, note, dep, assetNA, active sql.NullString
	var rawImage any
	if err := row.Scan(&rec.ID, &hostname, &ipAddress, &username, &users, &note, &dep, &rawImage, &assetNA, &active); err != nil {
		return rec, err
	}
	rec.Hostname = nullStringPtr(hostname)
	rec.IPAddress = nullStringPtr(ipAddress)
	rec.Username = nullStringPtr(username)
	rec.Users = nullStringPtr(users)
	rec.Note = nullStringPtr(note)
	rec.Dep = nullStringPtr(dep)
	rec.ImagePNG = stringPtrFromImage(rawImage)
	rec.AssetNA = nullStringPtr(assetNA)
	rec.Active = activeValue(active.String)
	return rec, nil
}

func (a *app) assetImagePaths(ctx context.Context, id int) ([]string, error) {
	var raw any
	if err := a.db.QueryRowContext(ctx, "SELECT img_png FROM dbo.allocate_antivirus WHERE id = @p1", id).Scan(&raw); err != nil {
		return nil, err
	}
	return splitImages(imageString(raw)), nil
}

func (a *app) imageDBValue(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if a.imgBinary {
		return []byte(value)
	}
	return value
}

func stringPtrFromImage(value any) *string {
	text := imageString(value)
	if strings.TrimSpace(text) == "" {
		return nil
	}
	return &text
}

func imageString(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case []byte:
		return strings.TrimRight(string(v), "\x00")
	case string:
		return strings.TrimRight(v, "\x00")
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func (a *app) saveUploadedImages(form *multipart.Form) ([]string, []string) {
	if form == nil || form.File == nil {
		return nil, nil
	}
	files := form.File["images[]"]
	if len(files) == 0 {
		files = form.File["images"]
	}

	images := []string{}
	errs := []string{}
	for _, header := range files {
		if len(images) >= 3 {
			break
		}
		if header.Size <= 0 {
			continue
		}
		if header.Size > 30<<20 {
			errs = append(errs, "file too large")
			continue
		}
		ext := strings.ToLower(filepath.Ext(header.Filename))
		if ext == ".jpeg" {
			ext = ".jpg"
		}
		if !map[string]bool{".jpg": true, ".png": true, ".gif": true, ".webp": true}[ext] {
			ext = ".jpg"
		}

		src, err := header.Open()
		if err != nil {
			errs = append(errs, "invalid file")
			continue
		}
		defer src.Close()

		sniff := make([]byte, 512)
		n, _ := src.Read(sniff)
		mime := http.DetectContentType(sniff[:n])
		if !strings.HasPrefix(mime, "image/") {
			errs = append(errs, "not valid image")
			continue
		}
		if _, err := src.Seek(0, io.SeekStart); err != nil {
			errs = append(errs, "invalid file")
			continue
		}

		name := fmt.Sprintf("%s_%d%s", time.Now().Format("20060102150405"), time.Now().UnixNano()%100000000, ext)
		destPath := filepath.Join(a.uploadDir, name)
		dest, err := os.Create(destPath)
		if err != nil {
			errs = append(errs, "save failed")
			continue
		}
		if _, err := io.Copy(dest, src); err != nil {
			_ = dest.Close()
			_ = os.Remove(destPath)
			errs = append(errs, "save failed")
			continue
		}
		_ = dest.Close()
		images = append(images, a.uploadURL+name)
	}
	return images, errs
}

func (a *app) removeImages(images []string) {
	uploadRoot := filepath.Clean(filepath.Dir(a.uploadDir))
	for _, img := range images {
		img = strings.TrimSpace(strings.TrimLeft(img, "/\\"))
		if img == "" {
			continue
		}
		rel := filepath.ToSlash(img)
		if strings.HasPrefix(rel, "uploads/") {
			rel = strings.TrimPrefix(rel, "uploads/")
		}
		target := filepath.Clean(filepath.Join(uploadRoot, filepath.FromSlash(rel)))
		if !strings.HasPrefix(strings.ToLower(target), strings.ToLower(uploadRoot)+string(os.PathSeparator)) {
			continue
		}
		_ = os.Remove(target)
	}
}

func requestValues(r *http.Request) map[string]string {
	values := map[string]string{}
	for key, items := range r.Form {
		if len(items) > 0 {
			values[key] = items[0]
		}
	}
	return values
}

func splitImages(value string) []string {
	out := []string{}
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func difference(values, removed []string) []string {
	blocked := map[string]bool{}
	for _, item := range removed {
		blocked[item] = true
	}
	out := []string{}
	for _, item := range values {
		if !blocked[item] {
			out = append(out, item)
		}
	}
	return out
}

func nullable(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func activeValue(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "N") {
		return "N"
	}
	return "Y"
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func loadAuthConfig() authConfig {
	timeoutSec, err := strconv.Atoi(getenv("AD_LDAP_TIMEOUT_SEC", "5"))
	if err != nil || timeoutSec <= 0 {
		timeoutSec = 5
	}
	jwtTTLMinutes, err := strconv.Atoi(getenv("JWT_TTL_MINUTES", "480"))
	if err != nil || jwtTTLMinutes <= 0 {
		jwtTTLMinutes = 480
	}

	ldapURL := strings.TrimSpace(os.Getenv("AD_LDAP_URL"))
	if ldapURL == "" {
		ldapURL = strings.TrimSpace(os.Getenv("AD1_SERVER"))
	}
	baseDN := strings.TrimSpace(firstNonEmpty(os.Getenv("AD2_BASE_DN"), os.Getenv("AD1_ROOT_DN"), os.Getenv("AD1_BASE_DN")))
	ldapDomain := strings.TrimSpace(os.Getenv("AD_LDAP_DOMAIN"))
	if ldapDomain == "" {
		ldapDomain = suffixFromDN(baseDN)
	}

	return authConfig{
		vpnLoginDSN: strings.TrimSpace(os.Getenv("VPN_LOGIN_DSN")),
		ldapURL:     ldapURL,
		ldapDomain:  ldapDomain,
		baseDN:      baseDN,
		bindPattern: strings.TrimSpace(os.Getenv("AD_LDAP_BIND_PATTERN")),
		startTLS:    boolEnv("AD_LDAP_START_TLS", false),
		insecureTLS: boolEnv("AD_LDAP_INSECURE_TLS", boolEnv("AD_TLS_INSECURE", false)),
		tlsMin:      tlsVersionEnv("AD_TLS_MIN_VERSION", tls.VersionTLS12),
		tlsMax:      tlsVersionEnv("AD_TLS_MAX_VERSION", 0),
		timeout:     time.Duration(timeoutSec) * time.Second,
		jwtSecret:   strings.TrimSpace(getenv("JWT_SECRET", "dev-only-change-me-please-32-bytes-min!!")),
		jwtTTL:      time.Duration(jwtTTLMinutes) * time.Minute,
	}
}

func (a *app) authenticateAD(ctx context.Context, username, password string) (string, error) {
	if strings.TrimSpace(a.auth.ldapURL) == "" {
		return "", fmt.Errorf("%w: AD_LDAP_URL or AD1_SERVER is required", errAuthNotReady)
	}

	bindUser, err := a.bindUsername(username)
	if err != nil {
		return "", err
	}

	conn, err := ldap.DialURL(
		a.auth.ldapURL,
		ldap.DialWithDialer(&net.Dialer{Timeout: a.auth.timeout}),
		ldap.DialWithTLSConfig(a.ldapTLSConfig()),
	)
	if err != nil {
		return "", fmt.Errorf("ไม่สามารถเชื่อมต่อ AD/LDAP ได้: %w", err)
	}
	defer conn.Close()

	if deadline, ok := ctx.Deadline(); ok {
		conn.SetTimeout(time.Until(deadline))
	} else {
		conn.SetTimeout(a.auth.timeout)
	}

	if a.auth.startTLS {
		if err := conn.StartTLS(a.ldapTLSConfig()); err != nil {
			return "", fmt.Errorf("ไม่สามารถเริ่ม LDAP StartTLS ได้: %w", err)
		}
	}

	if err := conn.Bind(bindUser, password); err != nil {
		var ldapErr *ldap.Error
		if errors.As(err, &ldapErr) && ldapErr.ResultCode == ldap.LDAPResultInvalidCredentials {
			return "", errInvalidCredentials
		}
		return "", fmt.Errorf("ตรวจสอบ AD/LDAP ไม่สำเร็จ: %w", err)
	}
	return a.lookupDisplayName(conn, username), nil
}

func (a *app) lookupDisplayName(conn *ldap.Conn, username string) string {
	if strings.TrimSpace(a.auth.baseDN) == "" {
		return username
	}

	search := ldap.NewSearchRequest(
		a.auth.baseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		1,
		int(a.auth.timeout.Seconds()),
		false,
		fmt.Sprintf("(sAMAccountName=%s)", ldap.EscapeFilter(username)),
		[]string{"displayName", "cn"},
		nil,
	)
	result, err := conn.Search(search)
	if err != nil || len(result.Entries) == 0 {
		return username
	}

	displayName := strings.TrimSpace(result.Entries[0].GetAttributeValue("displayName"))
	if displayName == "" {
		displayName = strings.TrimSpace(result.Entries[0].GetAttributeValue("cn"))
	}
	if displayName == "" {
		return username
	}
	return displayName
}

func (a *app) bindUsername(username string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", errInvalidCredentials
	}
	if a.auth.bindPattern != "" {
		if !strings.Contains(a.auth.bindPattern, "%s") {
			return "", fmt.Errorf("%w: AD_LDAP_BIND_PATTERN must contain %%s", errAuthNotReady)
		}
		return fmt.Sprintf(a.auth.bindPattern, username), nil
	}
	if a.auth.ldapDomain == "" {
		return "", fmt.Errorf("%w: AD_LDAP_DOMAIN or AD_LDAP_BIND_PATTERN is required", errAuthNotReady)
	}
	return username + "@" + a.auth.ldapDomain, nil
}

func (a *app) ldapTLSConfig() *tls.Config {
	cfg := &tls.Config{
		MinVersion:         a.auth.tlsMin,
		MaxVersion:         a.auth.tlsMax,
		InsecureSkipVerify: a.auth.insecureTLS,
	}
	if parsed, err := url.Parse(a.auth.ldapURL); err == nil {
		cfg.ServerName = parsed.Hostname()
	}
	return cfg
}

func (a *app) checkLoginPermission(ctx context.Context, username string) (string, error) {
	if a.vpnDB == nil || strings.TrimSpace(a.auth.vpnLoginDSN) == "" {
		return "", fmt.Errorf("%w: VPN_LOGIN_DSN is required", errAuthNotReady)
	}

	var status, role sql.NullString
	err := a.vpnDB.QueryRowContext(ctx, `
SELECT status, role
FROM dbo.vpn_login
WHERE UPPER(ADUser) = @p1`, username).Scan(&status, &role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNoPermission
	}
	if err != nil {
		return "", err
	}
	if !strings.EqualFold(strings.TrimSpace(status.String), "ACTIVE") {
		return "", errNoPermission
	}

	normalizedRole := strings.ToLower(strings.TrimSpace(role.String))
	if normalizedRole == "" {
		normalizedRole = "user"
	}
	return normalizedRole, nil
}

func (a *app) issueLoginToken(username, displayName, role string) (string, int64, error) {
	secret := strings.TrimSpace(a.auth.jwtSecret)
	if secret == "" {
		return "", 0, fmt.Errorf("%w: JWT_SECRET is required", errAuthNotReady)
	}

	now := time.Now()
	expiresAt := now.Add(a.auth.jwtTTL).Unix()
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	payload := map[string]any{
		"sub":  username,
		"name": displayName,
		"role": role,
		"iat":  now.Unix(),
		"exp":  expiresAt,
	}
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", 0, err
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", 0, err
	}

	unsigned := base64.RawURLEncoding.EncodeToString(headerJSON) + "." + base64.RawURLEncoding.EncodeToString(payloadJSON)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(unsigned))
	token := unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return token, expiresAt, nil
}

func normalizeADUsername(value string) string {
	value = strings.TrimSpace(value)
	if strings.Contains(value, `\`) {
		parts := strings.Split(value, `\`)
		value = parts[len(parts)-1]
	}
	if at := strings.Index(value, "@"); at >= 0 {
		value = value[:at]
	}
	return strings.ToUpper(strings.TrimSpace(value))
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func executableDir() string {
	exePath, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Dir(exePath)
}

func loadEnvFiles(paths ...string) {
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			loadEnvFile(path)
			return
		}
	}
}

func loadEnvFile(path string) {
	content, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, raw := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
}

func boolEnv(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func tlsVersionEnv(key string, fallback uint16) uint16 {
	switch strings.TrimSpace(os.Getenv(key)) {
	case "1.0":
		return tls.VersionTLS10
	case "1.1":
		return tls.VersionTLS11
	case "1.2":
		return tls.VersionTLS12
	case "1.3":
		return tls.VersionTLS13
	default:
		return fallback
	}
}

func suffixFromDN(dn string) string {
	labels := []string{}
	for _, part := range strings.Split(dn, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && strings.EqualFold(key, "DC") {
			labels = append(labels, value)
		}
	}
	return strings.Join(labels, ".")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
