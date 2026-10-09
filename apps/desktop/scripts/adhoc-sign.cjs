// Run by electron-builder once the app is assembled, before it goes into the disk image.
//
// There is no Apple developer certificate to sign the macOS app with. Left unsigned, the app is
// refused outright on Apple-silicon Macs ("the app is damaged and can't be opened"), because
// assembling it invalidates the signature Electron itself came with. Signing it "ad hoc", with no
// identity, makes it a valid app again: macOS then asks the usual question about an app from an
// unidentified developer, which the user can answer, instead of refusing.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  // Fails the build here rather than on a user's Mac if the result is not a valid app.
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
