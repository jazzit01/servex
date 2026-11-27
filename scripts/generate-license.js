#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const { generateKeyPairSync, createPrivateKey, sign } = require('node:crypto')

try {
  const [command, argument, publicFile] = process.argv.slice(2)
  if (command === '--init' && argument) {
    if (publicFile && (publicFile === argument || fs.existsSync(publicFile))) throw new Error('Choose a new path for the public key.')
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    fs.writeFileSync(argument, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 })
    const pem = publicKey.export({ format: 'pem', type: 'spki' })
    if (publicFile) fs.writeFileSync(publicFile, pem, { flag: 'wx' })
    else process.stdout.write(pem)
  } else if (/^[A-F0-9]{24}$/i.test(command ?? '') && argument) {
    const key = createPrivateKey(fs.readFileSync(argument))
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Choose an Ed25519 private key.')
    const signature = sign(null, Buffer.from('ServeX commercial v1:' + command.toUpperCase()), key)
    console.log('SVX-' + signature.toString('hex').toUpperCase().match(/.{4}/g).join('-'))
  } else {
    throw new Error('Usage: node scripts/generate-license.js --init /path/to/private.pem [build/license-public.pem] OR node scripts/generate-license.js MACHINE_ID /path/to/private.pem')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
