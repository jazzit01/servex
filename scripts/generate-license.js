#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { generateKeyPairSync, createPrivateKey, sign } = require('node:crypto')

const defaultPrivateFile = path.join(__dirname, 'license-private.pem')
const initCommand = 'node scripts/generate-license.js --init-keys'

try {
  const [command, argument, publicFile, extra] = process.argv.slice(2)
  if ((command === '--init-keys' || command === '--init') && extra === undefined) {
    const privateFile = argument ?? defaultPrivateFile
    if (publicFile && (path.resolve(publicFile) === path.resolve(privateFile) || fs.existsSync(publicFile))) {
      throw new Error('Choose a new path for the public key.')
    }
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    fs.writeFileSync(privateFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 })
    const pem = publicKey.export({ format: 'pem', type: 'spki' })
    if (publicFile) fs.writeFileSync(publicFile, pem, { flag: 'wx' })
    else process.stdout.write(pem)
  } else if (/^[A-F0-9]{24}$/i.test(command?.trim() ?? '') && publicFile === undefined) {
    const deviceId = command.trim().toUpperCase()
    const privateFile = argument ?? process.env.SERVEX_LICENSE_PRIVATE_KEY_FILE ?? defaultPrivateFile
    if (!fs.existsSync(privateFile)) throw new Error('Issuer key missing. Run ' + initCommand + ' to provision a new issuer.')
    const PRIVATE_KEY_PEM = fs.readFileSync(privateFile, 'utf8')
    const key = createPrivateKey(PRIVATE_KEY_PEM)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Choose an Ed25519 private key.')
    const signature = sign(null, Buffer.from(deviceId), key)
    console.log('SVX-' + signature.toString('base64url'))
  } else {
    throw new Error('Usage: ' + initCommand + ' [PRIVATE_PEM_PATH [PUBLIC_PEM_PATH]] or node scripts/generate-license.js DEVICE_ID [PRIVATE_PEM_PATH]')
  }
} catch (error) {
  if ((process.argv[2] === '--init-keys' || process.argv[2] === '--init') && error.code === 'EEXIST') {
    console.error('Key file already exists. To rotate without overwriting it, run ' + initCommand + ' /secure/path/new-issuer.pem')
  } else {
    console.error(error.message)
  }
  process.exitCode = 1
}
