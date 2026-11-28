#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { parseEnv } = require('node:util')
const { generateKeyPairSync, createPrivateKey, sign } = require('node:crypto')

const defaultPrivateFile = path.join(__dirname, 'license-private.pem')
const envFile = path.join(__dirname, '..', '.env')
const initCommand = 'node scripts/generate-license.js --init-keys'
const deviceFormat = /^[A-F0-9]{24}$/i

function issuerKey() {
  const fromEnvironment = process.env.SERVEX_PRIVATE_KEY?.trim()
  if (fromEnvironment) return fromEnvironment
  const localKey = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')).SERVEX_PRIVATE_KEY?.trim() : ''
  if (localKey) return localKey
  const privateFile = process.env.SERVEX_LICENSE_PRIVATE_KEY_FILE || defaultPrivateFile
  if (fs.existsSync(privateFile)) return fs.readFileSync(privateFile, 'utf8')
  throw new Error('Set SERVEX_PRIVATE_KEY in your environment or local .env. To create an issuer pair, run ' + initCommand)
}

function initialize(privateFile, publicFile) {
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.GITHUB_STEP_SUMMARY) {
    throw new Error('Generate the issuer key pair locally to keep the private key out of workflow logs.')
  }
  if (publicFile && (path.resolve(publicFile) === path.resolve(privateFile) || fs.existsSync(publicFile))) {
    throw new Error('Choose a new path for the public key.')
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' })
  const publicPem = publicKey.export({ format: 'pem', type: 'spki' })
  if (!privateFile) {
    process.stdout.write('PRIVATE_KEY_PEM (SERVEX_PRIVATE_KEY)\n' + privatePem + '\nPUBLIC_KEY_PEM\n' + publicPem)
    return
  }
  fs.writeFileSync(privateFile, privatePem, { flag: 'wx', mode: 0o600 })
  if (publicFile) fs.writeFileSync(publicFile, publicPem, { flag: 'wx' })
  else process.stdout.write(publicPem)
}

function outputLicense(deviceId, customerName, token) {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    // Encode Markdown and HTML punctuation so the name stays literal in the summary.
    const customer = customerName.replace(/[^\p{L}\p{N} ]/gu, character => `&#${character.codePointAt(0)};`)
    fs.appendFileSync(summary, [
      '## ServeX License Key', '',
      `**Customer Name** ${customer}`,
      '', `**Device ID** \`${deviceId}\``,
      '', '**Generated License Key**', '', '```text', token, '```',
      '', `**Timestamp (UTC)** ${new Date().toISOString()}`, '', '',
    ].join('\n'))
  }
  console.log(token)
}

try {
  const [command, argument, publicFile, extra] = process.argv.slice(2)
  if ((command === '--init-keys' || command === '--init') && extra === undefined) {
    initialize(command === '--init' ? argument ?? defaultPrivateFile : argument, publicFile)
  } else if (deviceFormat.test(command?.trim() ?? '') && publicFile === undefined) {
    const deviceId = command.trim().toUpperCase()
    const customerName = argument?.replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim() || 'Valued Customer'
    if (customerName.length > 120) throw new Error('Use a customer name up to 120 characters.')
    let key
    const pem = issuerKey()
    try { key = createPrivateKey(pem.replace(/\\n/g, '\n')) }
    catch { throw new Error('SERVEX_PRIVATE_KEY must contain a valid PEM private key.') }
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Choose an Ed25519 private key.')
    const signature = sign(null, Buffer.from(deviceId), key)
    outputLicense(deviceId, customerName, 'SVX-' + signature.toString('base64url'))
  } else {
    throw new Error('Enter the 24-character hexadecimal Device ID shown in ServeX. Usage: node scripts/generate-license.js DEVICE_ID [CUSTOMER_NAME] or ' + initCommand)
  }
} catch (error) {
  if ((process.argv[2] === '--init-keys' || process.argv[2] === '--init') && error.code === 'EEXIST') {
    console.error('Key file already exists. To rotate without overwriting it, run ' + initCommand + ' /secure/path/new-issuer.pem')
  } else {
    console.error(error.message)
  }
  process.exitCode = 1
}
