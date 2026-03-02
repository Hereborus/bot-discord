#define MyAppName "PNGTuber Bot"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Hereborus"
#define MyAppExeName "pngtuber-bot.exe"

[Setup]
AppId={{8FA2A1AB-0E97-4762-BB26-2FE8772B6D17}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\PNGTuber Bot
DefaultGroupName=PNGTuber Bot
OutputBaseFilename=pngtuber-bot-setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis:"; Flags: unchecked

[Files]
Source: "{#SourcePath}\dist\pngtuber-bot.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\index.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\viewer.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\positioner.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\styles.css"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\script.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\viewer.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\positioner.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\DOCUMENTATION.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\images\*"; DestDir: "{app}\images"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourcePath}\meta\*"; DestDir: "{app}\meta"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\PNGTuber Bot"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\PNGTuber Bot"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Lancer PNGTuber Bot"; Flags: nowait postinstall skipifsilent
