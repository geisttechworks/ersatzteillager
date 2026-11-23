#ifndef SourceDir
  #error SourceDir was not provided.
#endif
#ifndef OutputDir
  #error OutputDir was not provided.
#endif
#ifndef AppVersion
  #define AppVersion "1.0.1"
#endif

[Setup]
AppId={{8D8D65CC-BB55-47DB-B663-8E67F847EC0A}
AppName=Ersatzteillager
AppVersion={#AppVersion}
AppPublisher=Geist Techworks
AppSupportURL=mailto:geisttechworks@proton.me
AppComments=Lizenz: PolyForm Noncommercial 1.0.0
VersionInfoCompany=Geist Techworks
VersionInfoCopyright=Copyright (c) 2026 Wadim Geist / Geist Techworks
VersionInfoDescription=Ersatzteillager - PolyForm Noncommercial 1.0.0
DefaultDirName={autopf}\Ersatzteillager
DefaultGroupName=Ersatzteillager
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Ersatzteillager-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
UsedUserAreasWarning=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SetupLogging=yes
LicenseFile={#SourceDir}\LICENSE.md
UninstallDisplayName=Ersatzteillager
ChangesAssociations=no
ChangesEnvironment=no
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "autostart"; Description: "Ersatzteillager nach der Windows-Anmeldung automatisch starten"; GroupDescription: "Automatischer Start:"; Flags: checkedonce

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\Ersatzteillager starten"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\Start-Interactive.ps1"" -Target App"; WorkingDir: "{app}"; Check: not IsAutomatedTest
Name: "{group}\Ersatzteillager öffnen"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\Start-Interactive.ps1"" -Target App"; WorkingDir: "{app}"; Check: not IsAutomatedTest
Name: "{group}\Handy verbinden"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\Start-Interactive.ps1"" -Target Setup"; WorkingDir: "{app}"; Check: not IsAutomatedTest
Name: "{group}\Backup erstellen"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\Backup-Interactive.ps1"""; WorkingDir: "{app}"; Check: not IsAutomatedTest
Name: "{group}\Ersatzteillager beenden"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\Stop-Interactive.ps1"""; WorkingDir: "{app}"; Check: not IsAutomatedTest
Name: "{group}\Installationsanleitung"; Filename: "{app}\README-INSTALLATION.md"; Check: not IsAutomatedTest
Name: "{userstartup}\Ersatzteillager"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\Start-Interactive.ps1"" -Target Background"; WorkingDir: "{app}"; Tasks: autostart; Check: not IsAutomatedTest

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Configure-Firewall.ps1"""; StatusMsg: "Windows-Firewall für das private WLAN wird eingerichtet …"; Flags: runhidden waituntilterminated; Check: not IsAutomatedTest
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\First-Run.ps1"""; StatusMsg: "Erste Einrichtung wird geöffnet …"; Flags: runhidden waituntilterminated runasoriginaluser; Check: not IsAutomatedTest

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Stop-Ersatzteillager.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "StopErsatzteillager"; Check: not IsAutomatedTest
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Configure-Firewall.ps1"" -Remove"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewallRules"; Check: not IsAutomatedTest

[Code]
function IsAutomatedTest(): Boolean;
begin
  Result := ExpandConstant('{param:AutomatedTest|0}') = '1';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usUninstall) and (not IsAutomatedTest) then
    MsgBox('Die Lagerdaten und das lokale WLAN-Zertifikat werden aus Sicherheitsgründen nicht automatisch gelöscht. Sie bleiben unter %LOCALAPPDATA%\Ersatzteillager erhalten.', mbInformation, MB_OK);
end;
