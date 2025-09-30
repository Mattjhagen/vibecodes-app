# VibeCodes iOS App

This directory contains the iOS native app wrapper for VibeCodes, built using Capacitor.

## Prerequisites

- Xcode 15.0 or later
- iOS 17.0 or later
- Node.js 20.0 or later (for Capacitor CLI)
- CocoaPods

## Setup

1. **Install CocoaPods dependencies:**
   ```bash
   cd ios
   pod install
   ```

2. **Build the web app:**
   ```bash
   npm run build
   ```

3. **Sync with Capacitor:**
   ```bash
   npm run ios:sync
   ```

## Development

### Running the App

1. **Open in Xcode:**
   ```bash
   npm run ios:open
   ```

2. **Run on Simulator:**
   ```bash
   npm run ios:run
   ```

### Building for Testing

1. **Build and sync:**
   ```bash
   npm run ios:build
   ```

2. **Open in Xcode and build for device:**
   - Select your target device
   - Product → Build
   - Or use Product → Archive for distribution

## Configuration

The app is configured to:
- Load the VibeCodes web app from `https://vibecodes.app`
- Support all device orientations
- Use HTTPS for secure communication
- Allow arbitrary loads for development

## Testing

### Simulator Testing
1. Open Xcode
2. Select an iOS Simulator
3. Build and run the project

### Device Testing
1. Connect your iOS device
2. Select the device in Xcode
3. Build and run (requires Apple Developer account for device testing)

### TestFlight Distribution
1. **Prepare for TestFlight:**
   ```bash
   ./scripts/testflight-prep.sh
   ```

2. **Archive the app in Xcode:**
   - Select "Any iOS Device (arm64)"
   - Product → Archive
   - Validate and upload to App Store Connect

3. **Configure TestFlight:**
   - Add build information
   - Submit for beta review
   - Add internal/external testers

4. **Distribute for testing:**
   - Share TestFlight link
   - Monitor feedback and crashes

📖 **See TESTFLIGHT-DEPLOYMENT.md for detailed TestFlight instructions**

## Troubleshooting

### Common Issues

1. **Build errors:** Make sure all dependencies are installed with `pod install`
2. **WebView not loading:** Check network connectivity and URL configuration
3. **Signing issues:** Ensure proper code signing setup in Xcode

### Debugging

- Use Safari Web Inspector for web debugging
- Check Xcode console for native app logs
- Use Capacitor DevTools for hybrid app debugging
