param([ValidateSet('setup','get')][string]$Mode)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $root) -ne 'ceo-knowledgeweb-studio') { throw 'Unexpected project path' }
$runtime = Join-Path $root '.runtime'
$store = Join-Path $runtime 'remote-auth.bin'
Add-Type -AssemblyName System.Security
if ($Mode -eq 'setup') {
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  $random = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
  $code = [Convert]::ToBase64String($random).TrimEnd('=').Replace('+','-').Replace('/','_')
  $plain = [Text.Encoding]::UTF8.GetBytes($code)
  try { $protected = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser) }
  finally { [Array]::Clear($plain,0,$plain.Length); [Array]::Clear($random,0,$random.Length) }
  [IO.File]::WriteAllBytes($store,$protected)
  [Console]::Out.Write('SETUP_OK')
  exit 0
}
if (!(Test-Path -LiteralPath $store -PathType Leaf)) { throw 'Credential store is missing. Run setup first.' }
$protected = [IO.File]::ReadAllBytes($store)
$plain = [Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain)) }
finally { [Array]::Clear($plain,0,$plain.Length) }
