# ServeX POS

ServeX is an offline desktop POS starter for restaurants and lodging. It uses Electron, React, and SQLite through sql.js WebAssembly. It needs no database server or native module compilation.

## Development

Install Node.js 22 or newer. From this checkout, run:

```sh
npm ci
npm run dev
```

Sign in as the seeded demo administrator with PIN `1234`. Use F1 for takeaway, F2 for the floor map, and F3 for open orders and kitchen tickets. Development uses `data/servex-dev.db`. Installed copies use `servex-prod.db` under Electron’s application data directory.

Run `npm run build` to type-check and build both Electron and the renderer. For a Windows x64 release, run `npm run build:win` on Windows to create `release/ServeX-Setup.exe` and `release/ServeX-Portable.exe`. The portable app also stores data in application data. The build includes the SQLite WebAssembly binary and the ServeX icon.

## Branding assets

Replace `public/servex-logo.png` for the default renderer logo and `build/icon.ico` for Windows branding. The portable launcher inherits the Windows icon from `build.win.icon`.

## Release scope

This scaffold records Cash, Card, and UPI payment methods manually and sends kitchen tickets through the system print dialog. Before a live deployment, replace the demo credentials, validate tax and receipt requirements for your location, verify the printer on Windows, and sign the release executables.

## Management and backups

Administrators manage staff, floor locations, backup settings, and commercial licenses. Administrators and managers can edit branding, billing settings, and the menu. Change the seeded administrator PIN in **Settings → Staff & PINs** and set a separate manager override PIN before using cashier Z-close.

Use **Menu Manager → Download sample CSV** for the import format. Imports add missing categories and match dishes by name within each category. Use `1` or `0` for the Veg and In Stock columns. An invalid row rejects the entire import. Dish photos are managed separately from CSV.

On Windows, uploaded logos and dish photos are stored in `%APPDATA%\ServeX\media`. Encrypted `.svxbak` exports include SQLite and all ServeX media. The archive uses scrypt-derived AES-256-GCM encryption and gzip compression, with a 96 MB uncompressed limit. Keep the passphrase for a restore on another PC. Exiting normally keeps five device-encrypted backups in `%APPDATA%\ServeX\auto-backups`. Restore creates an encrypted safety snapshot in `restore-safety`. Automatic and safety snapshots use the Windows account's credential store key when available. For a PC migration, create a full backup with a passphrase first.

Cloud Backup sends the encrypted archive as an HTTPS POST with an `Authorization: Bearer` header and `application/octet-stream` body. Configure a service that accepts this contract. Automatic backup checks on startup and every 15 minutes while ServeX is open and uploads when a successful backup is due. Use Sync Now for an immediate upload. Cloud credentials are stored in the OS credential vault. Enter them again after moving to another PC. Restoring a cloud archive uses the cloud backup passphrase.

To verify commercial keys, deploy the issuer’s Ed25519 PEM public key as `SERVEX_LICENSE_PUBLIC_KEY`. A key is `base64url(JSON).base64url(signature)`, with the signature covering the encoded JSON segment. The claims require `plan: "commercial"` and `exp` as a future Unix timestamp in seconds.
