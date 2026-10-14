import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Worksheet } from 'exceljs'
import {
  Download,
  Circle,
  PanelLeftClose,
  PanelLeftOpen,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  ImageIcon,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react'

type LoginResponse = {
  success?: boolean
  username?: string
  displayName?: string
  role?: string
  token?: string
  expiresAt?: number
  message?: string
  error?: string
}

type LoginSession = {
  username: string
  displayName: string
  role: string
  token: string
  expiresAt: number
}

type AssetRecord = {
  id: number
  hostname?: string | null
  ip_address?: string | null
  username?: string | null
  users?: string | null
  note?: string | null
  dep?: string | null
  img_png?: string | null
  asset_na?: string | null
  Active?: string | null
}

type AssetForm = {
  id: string
  action: 'create' | 'update'
  hostname: string
  ip_address: string
  username: string
  users: string
  note: string
  dep: string
  asset_na: string
  Active: string
}

type PendingImage = {
  file: File
  previewUrl: string
}

type WorkspaceTab = 'assets' | 'reports'

const DEFAULT_API_BASE = `http://${window.location.hostname}:10101/api/AllocateAntivirus`
const API_BASE = (import.meta.env.VITE_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '')
const SESSION_KEY = 'allocate_antivirus_login_session'
const WORKSPACE_TAB_KEY = 'allocate_antivirus_workspace_tab'
const CONTROL_CARD_KEY = 'allocate_antivirus_control_card_visible'
const PAGE_SIZE = 10
const emptyForm: AssetForm = {
  id: '',
  action: 'create',
  hostname: '',
  ip_address: '',
  username: '',
  users: '',
  note: '',
  dep: '',
  asset_na: '',
  Active: 'Y',
}

function App() {
  const [session, setSession] = useState<LoginSession | null>(() => loadLoginSession())

  useEffect(() => {
    if (!session) return
    const expiresInMs = session.expiresAt * 1000 - Date.now()
    if (expiresInMs <= 0) {
      clearLoginSession()
      setSession(null)
      return
    }
    const timer = window.setTimeout(() => {
      clearLoginSession()
      setSession(null)
    }, expiresInMs)
    return () => window.clearTimeout(timer)
  }, [session])

  function handleLogin(nextSession: LoginSession) {
    saveLoginSession(nextSession)
    setSession(nextSession)
    window.history.replaceState(null, '', `${appBase()}?userCheck=${encodeURIComponent(nextSession.username)}`)
  }

  function handleLogout() {
    clearLoginSession()
    setSession(null)
    window.history.replaceState(null, '', appBase())
  }

  return session ? <Workspace session={session} onLogout={handleLogout} /> : <LoginPage onLogin={handleLogin} />
}

function LoginPage({ onLogin }: { onLogin: (session: LoginSession) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        },
        20000,
      )
      const result: LoginResponse = await res.json().catch(() => ({}))
      if (!res.ok || !result.success || !result.username || !result.token || !result.expiresAt) {
        throw new Error(result.error || result.message || 'Sign in failed')
      }
      onLogin({
        username: result.username,
        displayName: result.displayName || result.username,
        role: result.role || 'user',
        token: result.token,
        expiresAt: result.expiresAt,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-brand-panel" aria-label="Allocate Antivirus">
        <img src={`${appBase()}tnlx.svg`} alt="TNLX" className="login-logo" />
        <div className="login-brand-copy">
          <p className="login-eyebrow">TNLX - ALLOCATE ANTIVIRUS</p>
          <h1>Sign in</h1>
          <p>Manage your Allocate Antivirus workspace.</p>
          <p>Use your Active Directory account to continue.</p>
        </div>
        <footer className="login-footer">
          <span>TNLX COMPANY LIMITED</span>
          <span>ACCOUNT SERVICES</span>
        </footer>
      </section>

      <section className="login-form-panel" aria-labelledby="login-title">
        <form className="login-card" onSubmit={submitLogin}>
          <p className="login-card-kicker">TNLX</p>
          <h2 id="login-title">ALLOCATE ANTIVIRUS</h2>
          <p className="login-card-description">Sign in with your AD account.</p>

          <label className="login-field">
            <span>USERNAME</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value.toUpperCase())}
              placeholder="TXXXX"
              autoComplete="username"
              autoFocus
              required
            />
          </label>

          <label className="login-field">
            <span>PASSWORD</span>
            <div className="login-password">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </label>

          {error && <p className="login-error" role="alert">{error}</p>}

          <button type="submit" disabled={submitting} className="login-submit">
            {submitting && <Loader2 className="spin" size={18} />}
            Sign In
          </button>
        </form>
      </section>
    </main>
  )
}

function Workspace({ session, onLogout }: { session: LoginSession; onLogout: () => void }) {
  const [records, setRecords] = useState<AssetRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => loadWorkspaceTab())
  const [controlCardVisible, setControlCardVisible] = useState(() => loadControlCardVisibility())
  const [assetPage, setAssetPage] = useState(1)
  const [reportPage, setReportPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<AssetRecord | null>(null)
  const [viewerImage, setViewerImage] = useState('')
  const [form, setForm] = useState<AssetForm>(emptyForm)
  const [existingImages, setExistingImages] = useState<string[]>([])
  const [removedImages, setRemovedImages] = useState<string[]>([])
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])

  useEffect(() => {
    void loadAssets()
  }, [])

  useEffect(() => () => clearPendingImages(), [])

  const visibleRecords = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return records
    return records.filter((row) =>
      [row.hostname, row.ip_address, row.username, row.users, row.dep, row.note, row.asset_na, row.Active]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [records, search])

  const activeCount = records.filter((row) => normalizeActive(row.Active) === 'Y').length
  const inactiveCount = records.length - activeCount
  const depSummary = useMemo(() => buildDepSummary(records), [records])
  const assetPageCount = Math.max(1, Math.ceil(visibleRecords.length / PAGE_SIZE))
  const reportPageCount = Math.max(1, Math.ceil(depSummary.length / PAGE_SIZE))
  const paginatedRecords = visibleRecords.slice((assetPage - 1) * PAGE_SIZE, assetPage * PAGE_SIZE)

  useEffect(() => {
    setAssetPage(1)
  }, [search])

  useEffect(() => {
    setAssetPage((page) => Math.min(page, assetPageCount))
  }, [assetPageCount])

  useEffect(() => {
    setReportPage((page) => Math.min(page, reportPageCount))
  }, [reportPageCount])

  function selectTab(tab: WorkspaceTab) {
    setActiveTab(tab)
    window.localStorage.setItem(WORKSPACE_TAB_KEY, tab)
  }

  function toggleControlCard() {
    setControlCardVisible((visible) => {
      const nextVisible = !visible
      window.localStorage.setItem(CONTROL_CARD_KEY, String(nextVisible))
      return nextVisible
    })
  }

  async function loadAssets(options: { silent?: boolean } = {}) {
    const silent = options.silent ?? records.length > 0
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/assets?action=read`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Load failed')
      setRecords(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  function openCreate() {
    clearPendingImages()
    setForm(emptyForm)
    setExistingImages([])
    setRemovedImages([])
    setModalOpen(true)
  }

  async function openEdit(id: number) {
    setError('')
    try {
      const res = await fetch(`${API_BASE}/assets?action=get&id=${id}`)
      const row: AssetRecord & { error?: string } = await res.json()
      if (!res.ok) throw new Error(row.error || 'Not found')
      clearPendingImages()
      setForm({
        id: String(row.id),
        action: 'update',
        hostname: row.hostname || '',
        ip_address: row.ip_address || '',
        username: row.username || '',
        users: row.users || '',
        note: row.note || '',
        dep: row.dep || '',
        asset_na: row.asset_na || '',
        Active: normalizeActive(row.Active),
      })
      setExistingImages(splitImages(row.img_png))
      setRemovedImages([])
      setModalOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Open failed')
    }
  }

  function closeModal() {
    setModalOpen(false)
    clearPendingImages()
    setRemovedImages([])
  }

  function updateForm(key: keyof AssetForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function onImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files?.length) return
    const incoming = Array.from(files)
    event.target.value = ''
    if (existingImages.length + pendingImages.length + incoming.length > 3) {
      setError('Attach up to 3 images.')
      return
    }
    setError('')
    try {
      const compressed = await Promise.all(incoming.map((file) => compressImage(file)))
      setPendingImages((current) => [...current, ...compressed])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image failed')
    }
  }

  function removeExistingImage(src: string) {
    setExistingImages((current) => current.filter((item) => item !== src))
    setRemovedImages((current) => [...current, src])
  }

  function removePendingImage(index: number) {
    setPendingImages((current) => {
      const image = current[index]
      if (image) URL.revokeObjectURL(image.previewUrl)
      return current.filter((_, i) => i !== index)
    })
  }

  function clearPendingImages() {
    setPendingImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl))
      return []
    })
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res =
        pendingImages.length > 0
          ? await fetchWithTimeout(`${API_BASE}/assets`, { method: 'POST', body: buildFormData(form, pendingImages, removedImages) }, 30000)
          : await fetchWithTimeout(
              `${API_BASE}/assets`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, removed_images: removedImages.join(',') }),
              },
              30000,
            )
      const result = await res.json()
      if (!res.ok || !result.success) throw new Error(result.message || result.error || 'Save failed')
      setMessage(result.message || 'Saved')
      closeModal()
      await loadAssets({ silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord(row: AssetRecord) {
    setError('')
    setMessage('')
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/assets`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', id: String(row.id) }),
        },
        30000,
      )
      const result = await res.json()
      if (!res.ok || !result.success) throw new Error(result.message || 'Delete failed')
      setConfirmDelete(null)
      setMessage(result.message || 'Deleted')
      await loadAssets({ silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function exportReport() {
    setExporting(true)
    setError('')
    setMessage('')
    try {
      const exportRows = await fetchAssetRecords()
      setRecords(exportRows)
      await exportAllocateAntivirusWorkbook(exportRows)
      setMessage('Report exported')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block">
            <img src={`${appBase()}tnlx.svg`} alt="TNLX" className="brand-logo" />
            <span className="topbar-separator" />
            <div>
              <h1>ALLOCATE ANTIVIRUS</h1>
              <p>Asset management workspace</p>
            </div>
          </div>
          <nav className="top-nav" aria-label="Main navigation">
            <button type="button" className={activeTab === 'assets' ? 'nav-pill is-active' : 'nav-pill'} onClick={() => selectTab('assets')}>Assets</button>
            <button type="button" className={activeTab === 'reports' ? 'nav-pill is-active' : 'nav-pill'} onClick={() => selectTab('reports')}>Reports</button>
          </nav>
          <div className="topbar-actions">
            <div className="header-status" role="status">
              <Circle size={7} className="status-dot" />
              <span>{loading ? 'Loading' : refreshing ? 'Sync' : 'Ready'}</span>
            </div>
            <div className="header-user" title={session.displayName || session.username}>
              <UserRound size={15} />
              <span>{session.displayName || session.username}</span>
            </div>
            <button type="button" className="nav-button" onClick={onLogout}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className={activeTab === 'reports' ? 'workspace-grid reports-layout' : controlCardVisible ? 'workspace-grid' : 'workspace-grid assets-card-hidden'}>
         {activeTab === 'assets' && controlCardVisible && <aside className="side-panel" id="asset-control-panel">
             <section className="panel-card control-card" aria-label="Allocate Antivirus controls">
               <p className="eyebrow">ALLOCATE ANTIVIRUS</p>
               <h2>Asset Control</h2>
               <p className="muted">Manage antivirus allocation records and device images.</p>
               <button type="button" className="primary-button wide" onClick={openCreate}>
                 <Plus size={18} />
                 Add Asset
               </button>
               <button type="button" className="outline-button wide side-action" onClick={() => selectTab('reports')}>
                 <FileSpreadsheet size={18} />
                 Reports
               </button>
               <div className="stats-grid">
                 <Stat label="Total" value={records.length} />
                 <Stat label="Active" value={activeCount} />
                 <Stat label="Inactive" value={inactiveCount} />
               </div>
             </section>
          </aside>}

        {activeTab === 'reports' ? (
          <ReportsPanel
            records={records}
            depSummary={depSummary}
            notice={error || message}
            noticeType={error ? 'error' : 'success'}
            exporting={exporting}
            refreshing={refreshing}
            page={reportPage}
            pageCount={reportPageCount}
            onRefresh={() => void loadAssets({ silent: true })}
            onExport={() => void exportReport()}
            onPageChange={setReportPage}
          />
        ) : (
        <section className="content-panel">
           <div className="content-header">
             <div>
               <p className="eyebrow">ASSET LIST</p>
               <h2>Allocate Antivirus Records</h2>
               <p className="muted">{visibleRecords.length} records visible</p>
             </div>
             <div className="toolbar">
               <button type="button" className="outline-button" onClick={toggleControlCard} aria-controls="asset-control-panel" aria-expanded={controlCardVisible} title={controlCardVisible ? 'Hide control panel' : 'Show control panel'}>
                 {controlCardVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                 {controlCardVisible ? 'Hide panel' : 'Show panel'}
               </button>
               <button type="button" className="outline-button" onClick={() => void loadAssets({ silent: true })}>
                <RefreshCw size={16} />
                Refresh
              </button>
              <button type="button" className="primary-button" onClick={openCreate}>
                <Plus size={16} />
                Add
              </button>
            </div>
          </div>

          <div className="search-row">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา..." />
             {search && <button type="button" className="search-clear-button" onClick={() => setSearch('')} aria-label="Clear search" title="Clear search"><X size={14} /></button>}
          </div>

          {(error || message) && <div className={error ? 'notice error' : 'notice success'}>{error || message}</div>}

          <div className="table-wrap">
            <table className="asset-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Asset No</th>
                  <th>Hostname</th>
                  <th>IP Address</th>
                  <th>Username</th>
                  <th>Users</th>
                  <th>Dep</th>
                  <th>Note</th>
                  <th>Images</th>
                  <th>Active</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={11}><div className="empty-state"><Loader2 className="spin" /> Loading records...</div></td></tr>
                ) : visibleRecords.length === 0 ? (
                  <tr><td colSpan={11}><div className="empty-state">No records found.</div></td></tr>
                ) : (
                   paginatedRecords.map((row, index) => (
                     <tr key={row.id}>
                       <td className="cell-index">{(assetPage - 1) * PAGE_SIZE + index + 1}</td>
                      <td className="font-medium">{row.asset_na || '-'}</td>
                      <td className="font-semibold">{row.hostname || '-'}</td>
                      <td>{row.ip_address || '-'}</td>
                      <td>{row.username || '-'}</td>
                      <td>{row.users || '-'}</td>
                      <td>{row.dep || '-'}</td>
                      <td className="truncate-cell" title={row.note || undefined}>{row.note || '-'}</td>
                      <td>
                        <div className="thumb-row">
                          {splitImages(row.img_png).length ? splitImages(row.img_png).slice(0, 3).map((src) => (
                            <button key={src} type="button" className="table-thumb" onClick={() => setViewerImage(toImageURL(src))}>
                              <img src={toImageURL(src)} alt="" />
                            </button>
                          )) : '-'}
                        </div>
                      </td>
                      <td><span className={normalizeActive(row.Active) === 'Y' ? 'status-badge active' : 'status-badge inactive'}>{normalizeActive(row.Active)}</span></td>
                      <td>
                        <div className="action-row">
                          <button type="button" className="icon-button" title="Edit" onClick={() => void openEdit(row.id)}><Edit3 size={16} /></button>
                          <button type="button" className="icon-button danger" title="Delete" onClick={() => setConfirmDelete(row)}><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
           </div>
           <PaginationControls page={assetPage} pageCount={assetPageCount} total={visibleRecords.length} onPageChange={setAssetPage} />
         </section>
        )}
      </main>

      {modalOpen && (
        <AssetModal
          form={form}
          saving={saving}
          existingImages={existingImages}
          pendingImages={pendingImages}
          onClose={closeModal}
          onSubmit={submitForm}
          onChange={updateForm}
          onImageSelect={onImageSelect}
          onViewImage={setViewerImage}
          onRemoveExisting={removeExistingImage}
          onRemovePending={removePendingImage}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          record={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void deleteRecord(confirmDelete)}
        />
      )}

      {viewerImage && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setViewerImage('')}>
          <div className="image-viewer" role="dialog" aria-modal="true" aria-label="Asset image" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setViewerImage('')} aria-label="Close"><X size={18} /></button>
            <img src={viewerImage} alt="Asset" />
          </div>
        </div>
      )}
    </div>
  )
}

function ReportsPanel({
  records,
  depSummary,
  notice,
  noticeType,
  exporting,
  refreshing,
  page,
  pageCount,
  onRefresh,
  onExport,
  onPageChange,
}: {
  records: AssetRecord[]
  depSummary: Array<{ dep: string; count: number }>
  notice: string
  noticeType: 'error' | 'success'
  exporting: boolean
  refreshing: boolean
  page: number
  pageCount: number
  onRefresh: () => void
  onExport: () => void
  onPageChange: (page: number) => void
}) {
  const maxDepCount = Math.max(1, ...depSummary.map((item) => item.count))
  const paginatedDepSummary = depSummary.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <section className="content-panel report-panel">
      <div className="content-header">
        <div>
          <p className="eyebrow">REPORTS</p>
          <h2>Allocate Antivirus Export</h2>
          <p className="muted">Export Excel with main sheet, DEP sheets, and Sumary_Report.</p>
        </div>
        <div className="toolbar">
          <button type="button" className="outline-button" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            Refresh
          </button>
          <button type="button" className="primary-button" onClick={onExport} disabled={exporting}>
            {exporting ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
            Export Excel
          </button>
        </div>
      </div>

      <div className="report-grid">
        <section className="report-card">
          <div className="report-icon"><FileSpreadsheet size={24} /></div>
          <div>
            <p className="eyebrow">WORKBOOK</p>
            <h3>AllocateAntivirus.xlsx</h3>
            <p className="muted"></p>
          </div>
        </section>
        <section className="report-card">
          <strong>{records.length}</strong>
          <span>Total Records</span>
        </section>
        <section className="report-card">
          <strong>{depSummary.length}</strong>
          <span>DEP Sheets</span>
        </section>
      </div>

      <section className="dep-chart-card" aria-labelledby="dep-chart-title">
        <div className="section-title">
          <div>
            <p className="eyebrow">DEP DISTRIBUTION</p>
            <h3 id="dep-chart-title">Asset count by DEP</h3>
          </div>
          <span className="muted">{depSummary.length} departments</span>
        </div>
        {depSummary.length === 0 ? (
          <div className="empty-state">No DEP data to chart.</div>
        ) : (
          <div className="dep-chart">
            {depSummary.map((item) => (
              <div className="dep-chart-row" key={item.dep}>
                <div className="dep-chart-label" title={item.dep}>{item.dep}</div>
                <div className="dep-chart-track"><span className="dep-chart-bar" style={{ width: `${Math.max(5, (item.count / maxDepCount) * 100)}%` }} /></div>
                <strong className="dep-chart-value">{item.count}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {notice && <div className={noticeType === 'error' ? 'notice error' : 'notice success'}>{notice}</div>}

      <div className="table-wrap report-summary">
        <table className="asset-table">
          <thead>
            <tr>
              <th>#</th>
              <th>DEP Sheet</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {depSummary.length === 0 ? (
              <tr><td colSpan={3}><div className="empty-state">No DEP data to summarize.</div></td></tr>
            ) : (
               paginatedDepSummary.map((item, index) => (
                 <tr key={item.dep}>
                   <td className="cell-index">{(page - 1) * PAGE_SIZE + index + 1}</td>
                  <td className="font-semibold">{item.dep}</td>
                  <td>{item.count}</td>
                </tr>
              ))
            )}
          </tbody>
         </table>
       </div>
       <PaginationControls page={page} pageCount={pageCount} total={depSummary.length} onPageChange={onPageChange} />
     </section>
  )
}

function AssetModal({
  form,
  saving,
  existingImages,
  pendingImages,
  onClose,
  onSubmit,
  onChange,
  onImageSelect,
  onViewImage,
  onRemoveExisting,
  onRemovePending,
}: {
  form: AssetForm
  saving: boolean
  existingImages: string[]
  pendingImages: PendingImage[]
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onChange: (key: keyof AssetForm, value: string) => void
  onImageSelect: (event: ChangeEvent<HTMLInputElement>) => void
  onViewImage: (src: string) => void
  onRemoveExisting: (src: string) => void
  onRemovePending: (index: number) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title">
        <header className="modal-header">
          <div>
            <p className="eyebrow">ASSET DETAILS</p>
            <h2 id="asset-modal-title">{form.action === 'create' ? 'Add Asset' : 'Edit Asset'}</h2>
            <p className="muted">Record fields are saved.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <form onSubmit={onSubmit} className="modal-body">
           <fieldset className="form-group">
             <legend>Asset identity</legend>
             <div className="form-grid">
               <TextField label="Asset No" value={form.asset_na} onChange={(value) => onChange('asset_na', value)} />
               <TextField label="Hostname" value={form.hostname} onChange={(value) => onChange('hostname', value)} required />
             </div>
           </fieldset>

           <fieldset className="form-group">
             <legend>Network and assignment</legend>
             <div className="form-grid">
               <TextField label="IP Address" value={form.ip_address} onChange={(value) => onChange('ip_address', value)} />
               <TextField label="Username" value={form.username} onChange={(value) => onChange('username', value)} />
               <TextField label="Users" value={form.users} onChange={(value) => onChange('users', value)} />
               <TextField label="Dep" value={form.dep} onChange={(value) => onChange('dep', value)} />
             </div>
           </fieldset>

           <fieldset className="form-group">
             <legend>Status</legend>
             <div className="field">
               <span id="allocation-status-label">Allocation status</span>
               <button type="button" role="switch" className="active-switch" aria-checked={form.Active === 'Y'} aria-labelledby="allocation-status-label" onClick={() => onChange('Active', form.Active === 'Y' ? 'N' : 'Y')}>
                 <span className="switch-copy">
                   <strong>{form.Active === 'Y' ? 'Active' : 'Inactive'}</strong>
                   <small>{form.Active === 'Y' ? 'Antivirus is allocated to this asset' : 'Antivirus is not allocated to this asset'}</small>
                 </span>
                 <span className="switch-track" aria-hidden="true">
                   <span className="switch-thumb" />
                 </span>
               </button>
             </div>
           </fieldset>

           <fieldset className="form-group">
             <legend>Notes</legend>
             <label className="field">
               <span>Note</span>
               <textarea value={form.note} onChange={(event) => onChange('note', event.target.value)} rows={4} />
             </label>
           </fieldset>

           <section className="image-section form-group">
            <div className="section-title">
              <div>
                <h3>Images</h3>
                <p>Attach up to 3 images.</p>
              </div>
              <label className="upload-button">
                <Upload size={17} />
                Select Images
                <input type="file" accept="image/*" multiple onChange={onImageSelect} />
              </label>
            </div>
            <div className="image-grid">
              {existingImages.map((src) => (
                <ImageThumb key={src} src={toImageURL(src)} onView={() => onViewImage(toImageURL(src))} onRemove={() => onRemoveExisting(src)} />
              ))}
              {pendingImages.map((image, index) => (
                <ImageThumb key={image.previewUrl} src={image.previewUrl} onView={() => onViewImage(image.previewUrl)} onRemove={() => onRemovePending(index)} />
              ))}
              {existingImages.length + pendingImages.length === 0 && <div className="image-empty"><ImageIcon size={22} /> No images attached.</div>}
            </div>
          </section>

          <footer className="modal-actions">
            <button type="button" className="outline-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Save
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function ConfirmModal({ record, onCancel, onConfirm }: { record: AssetRecord; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <div className="confirm-icon"><Trash2 size={24} /></div>
        <h2 id="delete-title">Delete asset?</h2>
        <p><strong>{record.hostname || record.asset_na || `#${record.id}`}</strong></p>
        <p className="muted">This record and its image files will be removed.</p>
        <div className="modal-actions">
          <button type="button" className="outline-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="danger-button" onClick={onConfirm}>Delete</button>
        </div>
      </section>
    </div>
  )
}

function TextField({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="field">
      <span>{label}{required && <b>*</b>}</span>
      <input value={value} required={required} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function ImageThumb({ src, onView, onRemove }: { src: string; onView: () => void; onRemove: () => void }) {
  return (
    <div className="image-thumb">
      <button type="button" onClick={onView} aria-label="View image"><img src={src} alt="" /></button>
      <button type="button" onClick={onRemove} className="remove-image" aria-label="Remove image"><X size={14} /></button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-tile">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

async function fetchAssetRecords() {
  const res = await fetch(`${API_BASE}/assets?action=read`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Load failed')
  return Array.isArray(data) ? data as AssetRecord[] : []
}

async function exportAllocateAntivirusWorkbook(records: AssetRecord[]) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AllocateAntivirus'
  workbook.created = new Date()
  workbook.modified = new Date()

  const usedNames = new Set<string>()
  const mainSheet = workbook.addWorksheet('AllocateAntivirus')
  usedNames.add(mainSheet.name.toLowerCase())
  fillReportSheet(mainSheet, records)

  const grouped = groupByDep(records)
  for (const [dep, rows] of grouped) {
    const sheet = workbook.addWorksheet(uniqueSheetName(dep, usedNames))
    fillReportSheet(sheet, rows)
  }

  const summarySheet = workbook.addWorksheet('Sumary_Report')
  fillSummarySheet(summarySheet, grouped)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `AllocateAntivirus_${fileDate(new Date())}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function fillReportSheet(sheet: Worksheet, records: AssetRecord[]) {
  sheet.columns = [
    { header: 'HOSTNAME', key: 'hostname', width: 24 },
    { header: 'IP ADDRESS', key: 'ip_address', width: 18 },
    { header: 'USERNAME', key: 'username', width: 18 },
    { header: 'USERS', key: 'users', width: 24 },
    { header: 'DEP', key: 'dep', width: 18 },
    { header: 'NOTE', key: 'note', width: 36 },
    { header: 'ACTIVE', key: 'Active', width: 12 },
  ]
  records.forEach((record) => {
    sheet.addRow({
      hostname: cellText(record.hostname),
      ip_address: cellText(record.ip_address),
      username: cellText(record.username),
      users: cellText(record.users),
      dep: depName(record.dep),
      note: cellText(record.note),
      Active: normalizeActive(record.Active),
    })
  })
  styleWorksheet(sheet)
}

function fillSummarySheet(sheet: Worksheet, grouped: Map<string, AssetRecord[]>) {
  sheet.columns = [
    { header: 'DEP', key: 'dep', width: 24 },
    { header: 'COUNT', key: 'count', width: 14 },
  ]
  Array.from(grouped.entries()).forEach(([dep, rows]) => {
    sheet.addRow({ dep, count: rows.length })
  })
  styleWorksheet(sheet)
}

function styleWorksheet(sheet: Worksheet) {
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.font = { name: 'Angsana New', size: 14 }
      cell.alignment = { vertical: 'middle', wrapText: true }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD8E3EF' } },
        left: { style: 'thin', color: { argb: 'FFD8E3EF' } },
        bottom: { style: 'thin', color: { argb: 'FFD8E3EF' } },
        right: { style: 'thin', color: { argb: 'FFD8E3EF' } },
      }
    })
  })
  const header = sheet.getRow(1)
  header.eachCell((cell) => {
    cell.font = { name: 'Angsana New', size: 14, bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5F3' } }
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  }
}

function groupByDep(records: AssetRecord[]) {
  const grouped = new Map<string, AssetRecord[]>()
  records.forEach((record) => {
    const key = depName(record.dep)
    grouped.set(key, [...(grouped.get(key) || []), record])
  })
  return new Map(Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)))
}

function buildDepSummary(records: AssetRecord[]) {
  return Array.from(groupByDep(records).entries()).map(([dep, rows]) => ({ dep, count: rows.length }))
}

function depName(value?: string | null) {
  return cellText(value) || 'NO_DEP'
}

function uniqueSheetName(value: string, usedNames: Set<string>) {
  const base = sanitizeSheetName(value)
  let name = base
  let index = 2
  while (usedNames.has(name.toLowerCase())) {
    const suffix = `_${index}`
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`
    index += 1
  }
  usedNames.add(name.toLowerCase())
  return name
}

function sanitizeSheetName(value: string) {
  const cleaned = value.replace(/[\\/?*:[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  return (cleaned || 'NO_DEP').slice(0, 31)
}

function cellText(value?: string | null) {
  return String(value || '').trim()
}

function fileDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}

function buildFormData(form: AssetForm, pendingImages: PendingImage[], removedImages: string[]) {
  const data = new FormData()
  Object.entries(form).forEach(([key, value]) => data.set(key, value))
  data.set('removed_images', removedImages.join(','))
  pendingImages.forEach((image) => data.append('images[]', image.file, image.file.name))
  return data
}

function appBase() {
  return import.meta.env.BASE_URL || '/AllocateAntivirus/'
}

function splitImages(value?: string | null) {
  return (value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function toImageURL(src: string) {
  if (/^https?:\/\//i.test(src)) return src
  return `${API_BASE}/${src.replace(/^\/+/, '')}`
}

function normalizeActive(value?: string | null) {
  return String(value || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y'
}

function loadLoginSession(): LoginSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as Partial<LoginSession>
    if (!session.username || !session.token || !session.expiresAt || session.expiresAt * 1000 <= Date.now()) {
      clearLoginSession()
      return null
    }
    return {
      username: String(session.username).toUpperCase(),
      displayName: String(session.displayName || session.username),
      role: String(session.role || 'user'),
      token: String(session.token),
      expiresAt: Number(session.expiresAt),
    }
  } catch {
    clearLoginSession()
    return null
  }
}

function saveLoginSession(session: LoginSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function clearLoginSession() {
  window.localStorage.removeItem(SESSION_KEY)
}

function PaginationControls({ page, pageCount, total, onPageChange }: { page: number; pageCount: number; total: number; onPageChange: (page: number) => void }) {
  return (
    <div className="pagination-bar" aria-label="Table pagination">
      <span className="pagination-summary">{total === 0 ? 'No records' : `Page ${page} of ${pageCount} · ${total} records`}</span>
      <div className="pagination-actions">
        <button type="button" className="outline-button pagination-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
        <button type="button" className="outline-button pagination-button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Next</button>
      </div>
    </div>
  )
}

function loadWorkspaceTab(): WorkspaceTab {
  return window.localStorage.getItem(WORKSPACE_TAB_KEY) === 'reports' ? 'reports' : 'assets'
}

function loadControlCardVisibility() {
  return window.localStorage.getItem(CONTROL_CARD_KEY) !== 'false'
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

function compressImage(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    if (file.size > 30 * 1024 * 1024) {
      reject(new Error('Image is larger than 30MB.'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Cannot read image.'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Invalid image.'))
      image.onload = () => {
        const maxDim = 1600
        let width = image.width
        let height = image.height
        if (width > maxDim || height > maxDim) {
          const ratio = maxDim / Math.max(width, height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Cannot process image.'))
          return
        }
        context.drawImage(image, 0, 0, width, height)
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Cannot process image.'))
              return
            }
            const ext = mime === 'image/png' ? 'png' : 'jpg'
            const name = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}.${ext}`
            const nextFile = new File([blob], name, { type: mime })
            resolve({ file: nextFile, previewUrl: URL.createObjectURL(blob) })
          },
          mime,
          mime === 'image/jpeg' ? 0.76 : 1,
        )
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export default App
