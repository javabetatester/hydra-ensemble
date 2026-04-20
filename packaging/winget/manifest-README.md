# Winget manifest

To publish `Hydra.Ensemble` on the official Windows Package Manager:

1. Fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
2. Drop the three YAML files below into `manifests/h/Hydra/Ensemble/0.1.0/`.
3. Run `winget validate manifests/h/Hydra/Ensemble/0.1.0`.
4. Open a PR. Auto-validation + one human review merges it.

**Important** — winget REQUIRES the `.exe` to be **Authenticode-signed**.
Buy a code signing cert (~US$200/yr) and add `CSC_LINK` / `CSC_KEY_PASSWORD`
to the release workflow. Without signing, the PR will be rejected
because SmartScreen blocks every launch.

---

## Hydra.Ensemble.yaml
```yaml
PackageIdentifier: Hydra.Ensemble
PackageVersion: 0.1.0
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
```

## Hydra.Ensemble.installer.yaml
```yaml
PackageIdentifier: Hydra.Ensemble
PackageVersion: 0.1.0
Platform:
  - Windows.Desktop
MinimumOSVersion: 10.0.0.0
InstallerType: nullsoft
Scope: user
UpgradeBehavior: install
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/javabetatester/hydra-ensemble/releases/download/v0.1.0/Hydra-Ensemble-Setup-0.1.0.exe
    InstallerSha256: REPLACE_WITH_SHA256_OF_THE_EXE
ManifestType: installer
ManifestVersion: 1.6.0
```

## Hydra.Ensemble.locale.en-US.yaml
```yaml
PackageIdentifier: Hydra.Ensemble
PackageVersion: 0.1.0
PackageLocale: en-US
Publisher: Intuitive Compute
PublisherUrl: https://hydra-ensemble.xyz
PublisherSupportUrl: https://github.com/javabetatester/hydra-ensemble/issues
PackageName: Hydra Ensemble
PackageUrl: https://hydra-ensemble.xyz
License: MIT
LicenseUrl: https://github.com/javabetatester/hydra-ensemble/blob/main/LICENSE
ShortDescription: Cross-platform multi-session terminal for Claude Code.
Description: |
  Hydra Ensemble orchestrates parallel Claude Code agents — each session gets
  its own git worktree, live PTY status detection, and cost tracking.
Tags:
  - claude
  - claude-code
  - terminal
  - developer-tools
  - ai
ManifestType: defaultLocale
ManifestVersion: 1.6.0
```

Compute the SHA256 locally once v0.1.0 assets land:
```bash
sha256sum release/Hydra-Ensemble-Setup-0.1.0.exe
```
