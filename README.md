# ServeX POS

ServeX is an offline desktop POS for restaurants, garden venues, and lodging. It uses Electron, React, and SQLite through sql.js WebAssembly. It needs no database server or native module compilation.

## Development

Install Node.js 22 or newer. From this checkout, run:

```sh
npm ci
npm run dev
```

On first launch, configure branding, choose a venue preset, and set your admin PIN. To use the demo, enter the default demo PIN `1234` during setup. Existing seeded installations use `1234` until changed. Use F1 for takeaway, F2 for the floor map or Send KOT in Billing, F3 for the kitchen queue, and F4 to open checkout in Billing or from a table’s actions. Development uses `data/servex-dev.db`. Installed copies use `servex-prod.db` under Electron’s application data directory.

Run `npm run build` to type-check and build both Electron and the renderer. For a Windows x64 release, run `npm run build:win` on Windows to create `release/ServeX-Setup.exe` and `release/ServeX-Portable.exe`. The portable app also stores data in application data. The build includes the SQLite WebAssembly binary and the ServeX icon.

## Branding assets

Replace `public/servex-logo.png` for the default renderer logo and `build/icon.ico` for Windows branding. The portable launcher inherits the Windows icon from `build.win.icon`.

## Release and printing

ServeX records Cash, Card, UPI, and Room Folio locally. Confirm external payments before completing checkout. Receipt previews are enabled by default. In **Settings → Restaurant settings**, choose 58 mm or 80 mm and specify the operating system's printer name if you do not use the system default. For a commercial release, verify native Windows printing and installation, sign the executables, and validate the tax and receipt requirements for your jurisdiction.

## Management and backups

Administrators manage staff, floor locations, backup settings, and commercial licenses. Administrators and managers can edit branding, billing settings, and the menu. Change the seeded administrator PIN in **Settings → Staff & PINs** and set a separate manager override PIN before using cashier Z-close.

Use **Menu Manager → Download sample CSV** for the import format. Imports add missing categories and match dishes by name within each category. Use `1` or `0` for the Veg and In Stock columns. An invalid row rejects the entire import. Dish photos are managed separately from CSV.

On Windows, uploaded logos and dish photos are stored in `%APPDATA%\ServeX\media`. Encrypted `.svxbak` exports include SQLite and all ServeX media. The archive uses scrypt-derived AES-256-GCM encryption and gzip compression, with a 96 MB uncompressed limit. Keep the passphrase for a restore on another PC. Exiting normally keeps five device-encrypted backups in `%APPDATA%\ServeX\auto-backups`. Restore creates an encrypted safety snapshot in `restore-safety`. Automatic and safety snapshots use the Windows account's credential store key when available. For a PC migration, create a full backup with a passphrase first.

Cloud Backup sends the encrypted archive as an HTTPS POST with an `Authorization: Bearer` header and `application/octet-stream` body. Configure a service that accepts this contract. Automatic backup checks on startup and every 15 minutes while ServeX is open and uploads when a successful backup is due. Use Sync Now for an immediate upload. Cloud credentials are stored in the OS credential vault. Enter them again after moving to another PC. Restoring a cloud archive uses the cloud backup passphrase.

## Reports and day closing

Reports use the device's local business date. A paid bill contributes sales when closed. A recorded receipt void offsets sales and cash on the day of the reversal. A Z-close stores a read-only denomination count and an 80 mm summary. Its encrypted snapshot is saved in `z-backups` under ServeX's data directory. On a host without OS credential storage, Z-close prompts for a backup passphrase. Reopen the Z-Close tab to reprint or retry a failed snapshot. Audit CSVs can be opened in Excel.

## Generating Customer License Keys

A new device gets seven days of full trial access. Activation is offline and bound to its machine ID. Create one issuer key pair before building a release:

```sh
node scripts/generate-license.js --init /secure/location/servex-private.pem build/license-public.pem
npm run build:win
```

Only the public key is packaged. Keep the private key outside the repository and distribute builds with the same public key that matches your issuer. During development, a PEM public key can also be supplied in `SERVEX_LICENSE_PUBLIC_KEY`.

Ask the customer for the machine ID shown in **Activate ServeX**, then generate their key:

```sh
node scripts/generate-license.js MACHINE_ID /secure/location/servex-private.pem
```

The displayed `SVX-…` key contains a full Ed25519 signature. Only the issuer can sign for another machine. Buyers can use the full trial without an issuer key, while paid activations require an issuer-configured build. If you previously issued a legacy activation token, issue a new machine-bound key for this version.

## Mobile Waiter Sync

Enable **Settings → Mobile Waiter Sync** from an administrator account. The QR contains a JSON object with `version`, the private IPv4 `url` on port 4890, and a revocable `token`. Turn sync off to revoke the token. The scanner and POS must be on the same trusted private network. HTTP and WebSocket traffic on this bridge is unencrypted, so keep it off shared networks and avoid port forwarding.

Native clients send `Authorization: Bearer <token>`. The bridge exposes:

- `GET /api/v1/catalog` for zones, tables, categories, and available menu items.
- `POST /api/v1/orders` with `Content-Type: application/json` and a unique `Idempotency-Key` of 16–100 ASCII letters, digits, underscores, or hyphens. Example body: `{"type":"dinein","tableId":1,"items":[{"id":1,"quantity":2,"notes":"No onion"}]}`. Use `type: "parcel"` and a null table for takeaway.
- `WS /api/v1/events` with the same authorization header. The server emits `ready` on connection and `catalog-changed` when a client should fetch updated data.
