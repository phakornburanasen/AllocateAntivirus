use SSO_Agent_tnlx


CREATE TABLE [dbo].[allocate_antivirus]
(
    [id] INT IDENTITY(1,1) NOT NULL,
    [hostname] NVARCHAR(100) NULL,
    [ip_address] VARCHAR(45) NULL,
    [username] NVARCHAR(100) NULL,
    [users] NVARCHAR(255) NULL,
    [note] NVARCHAR(MAX) NULL,
    [dep] NVARCHAR(100) NULL,
    [img_png] VARBINARY(MAX) NULL,
    [asset_na] NVARCHAR(100) NULL,

    [Active] CHAR(1) NOT NULL
        CONSTRAINT [DF_allocate_antivirus_Active]
        DEFAULT ('Y'),

    [year] SMALLINT NULL,

    CONSTRAINT [PK_allocate_antivirus]
        PRIMARY KEY CLUSTERED ([id]),

    CONSTRAINT [CK_allocate_antivirus_Active]
        CHECK ([Active] IN ('Y', 'N'))
);
