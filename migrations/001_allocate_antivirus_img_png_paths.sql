USE SSO_Agent_tnlx;
GO

/*
  AllocateAntivirus stores up to three uploaded image paths in img_png, separated
  by commas, matching the SSO_Check upload pattern.

  The original SQL.sql defined img_png as VARBINARY(MAX). Run this migration
  before relying on image path storage in production.
*/

IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'allocate_antivirus'
      AND COLUMN_NAME = 'img_png'
      AND DATA_TYPE = 'varbinary'
)
BEGIN
    ALTER TABLE dbo.allocate_antivirus
    ALTER COLUMN img_png NVARCHAR(MAX) NULL;
END;
GO
