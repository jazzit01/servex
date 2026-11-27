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

## Branding and backups

Settings accepts PNG and JPEG logos. ServeX stores an uploaded copy in the local `logos` directory beside the database. Replace `public/servex-logo.png` for the default renderer logo and `build/icon.ico` for Windows branding.

The `.svxbak` export contains the SQLite database. Copy the `logos` directory separately when moving to another machine. Restoring a backup replaces the local database and locks the till.

## Release scope

This scaffold records Cash, Card, and UPI payment methods manually and sends kitchen tickets through the system print dialog. Before a live deployment, replace the demo credentials, validate tax and receipt requirements for your location, verify the printer on Windows, and sign the release executables.
