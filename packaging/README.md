# Hydra Ensemble — packaging scaffolds

Templates for publishing Hydra on each platform's **official** package manager.
Each folder is a starting point — tweak, copy to the right upstream repo, open
a PR or push.

## Linux · AUR (yay / paru)

Publishes `hydra-ensemble-bin` to the Arch User Repository. Arch users install
with `yay -S hydra-ensemble-bin` or `paru -S hydra-ensemble-bin`.

**Setup (one time):**

1. Register at https://aur.archlinux.org (needs a public SSH key).
2. `ssh-keygen -t ed25519 -C "aur@javabetatester"` and add the pub to AUR
   profile.
3. Clone the AUR remote:
   ```bash
   git clone ssh://aur@aur.archlinux.org/hydra-ensemble-bin.git
   cd hydra-ensemble-bin
   ```
4. Copy `aur/PKGBUILD` and `aur/hydra-ensemble.desktop` into that repo.
5. Regenerate checksums and the mandatory `.SRCINFO`:
   ```bash
   updpkgsums                     # rewrites sha256sums in PKGBUILD
   makepkg --printsrcinfo > .SRCINFO
   git add PKGBUILD .SRCINFO hydra-ensemble.desktop
   git commit -m "v0.1.0 — initial upload"
   git push
   ```
6. New tag? Bump `pkgver` + `pkgrel=1`, repeat steps 5–6.

## macOS · curl installer

Served from the LP at `https://hydra-ensemble.xyz/install.sh` — detects OS,
mounts the latest `.dmg`, copies the `.app` into `/Applications`, strips the
Gatekeeper quarantine bit. No brew tap yet; consider adding one later if the
user count justifies the maintenance.

No action needed — the installer is already in `Hydra-LP/public/install.sh`
and auto-deploys with the site.

## Windows · winget

See `winget/manifest-README.md`. Requires Authenticode code signing (~$200/yr)
before Microsoft accepts the PR — without it SmartScreen blocks the installer
on first launch and the manifest PR is rejected in review.

For now the `.exe` is downloadable directly from the GitHub Release; when
signing is set up the manifest goes into `microsoft/winget-pkgs`.

## Scoop (optional community bucket)

Not included as an "official" install path since Scoop requires a custom
bucket repo, but trivial to add later: `scoop bucket add hydra https://github.com/javabetatester/scoop-hydra`
plus a JSON manifest.

## Homebrew tap (optional)

Same story — either a personal tap (`javabetatester/homebrew-hydra`) or a PR
into the official `homebrew-cask`. Official cask needs Apple notarization
($99/yr Apple Developer + notarytool), so skip until that lands.
