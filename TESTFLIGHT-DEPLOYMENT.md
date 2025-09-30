# TestFlight Deployment Guide 🚀

This guide will walk you through deploying your VibeCodes iOS app to TestFlight for beta testing.

## Prerequisites

Before starting, ensure you have:

- ✅ Apple Developer Account ($99/year)
- ✅ Xcode 15.0 or later installed
- ✅ iOS device for testing (optional but recommended)
- ✅ CocoaPods installed (`gem install cocoapods`)

## Step 1: Apple Developer Account Setup

### 1.1 Create Apple Developer Account
1. Go to [developer.apple.com](https://developer.apple.com)
2. Sign in with your Apple ID
3. Enroll in the Apple Developer Program ($99/year)
4. Wait for approval (usually 24-48 hours)

### 1.2 Create App ID
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Click **Identifiers** → **App IDs**
4. Click **+** to create new App ID
5. Fill in:
   - **Description**: VibeCodes
   - **Bundle ID**: `com.vibecodes.app` (must match your app)
   - **Capabilities**: Enable any needed capabilities
6. Click **Continue** → **Register**

## Step 2: Prepare Your Project

### 2.1 Install Dependencies
```bash
# Make sure you're in the project root
cd /Users/matty/vibecodes-app-1

# Install iOS dependencies
cd ios
pod install
cd ..
```

### 2.2 Build the Web App
```bash
# Build the latest version
npm run build
```

## Step 3: Configure Xcode Project

### 3.1 Open Project in Xcode
```bash
npm run ios:open
```

### 3.2 Configure Team and Bundle ID
1. In Xcode, select the **App** project in the navigator
2. Select the **App** target
3. Go to **Signing & Capabilities** tab
4. Set:
   - **Team**: Your Apple Developer Team
   - **Bundle Identifier**: `com.vibecodes.app`
   - **Signing Certificate**: Automatic or Manual

### 3.3 Update Version and Build Number
1. In **General** tab, set:
   - **Version**: `1.0` (or increment for updates)
   - **Build**: `1` (increment for each build)

## Step 4: Create App in App Store Connect

### 4.1 Add New App
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Click **My Apps** → **+** → **New App**
3. Fill in:
   - **Platform**: iOS
   - **Name**: VibeCodes
   - **Primary Language**: English
   - **Bundle ID**: Select `com.vibecodes.app`
   - **SKU**: `vibecodes-ios` (unique identifier)
4. Click **Create**

### 4.2 Complete App Information
1. Fill in required fields:
   - **App Description**
   - **Keywords**
   - **Support URL**
   - **Marketing URL** (optional)
2. Upload app screenshots (required for TestFlight)
3. Set **App Category**
4. Add **App Review Information**

## Step 5: Build and Archive

### 5.1 Select Target Device
1. In Xcode, select **Any iOS Device (arm64)** from device dropdown
2. Or select your connected device

### 5.2 Archive the App
1. Go to **Product** → **Archive**
2. Wait for build to complete
3. The **Organizer** window will open automatically

### 5.3 Validate Archive
1. In Organizer, select your archive
2. Click **Validate App**
3. Choose **App Store Connect**
4. Click **Next** → **Validate**
5. Fix any validation errors if they occur

## Step 6: Upload to App Store Connect

### 6.1 Distribute App
1. In Organizer, select your validated archive
2. Click **Distribute App**
3. Choose **App Store Connect**
4. Click **Next**

### 6.2 Upload Options
1. Select **Upload**
2. Click **Next**
3. Choose **Automatically manage signing**
4. Click **Next** → **Upload**

### 6.3 Monitor Upload
1. Wait for upload to complete
2. You'll see a success message
3. The build will appear in App Store Connect (may take 10-30 minutes)

## Step 7: Configure TestFlight

### 7.1 Access TestFlight
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Select your **VibeCodes** app
3. Click **TestFlight** tab

### 7.2 Add Build Information
1. Find your uploaded build
2. Click **Add Build Information**
3. Add:
   - **What to Test**: Description of new features
   - **Test Details**: Instructions for testers
   - **Feedback Email**: Your email for feedback

### 7.3 Submit for Beta Review
1. Click **Submit for Review**
2. Wait for Apple's beta review (usually 24-48 hours)
3. You'll receive email notification when approved

## Step 8: Add Testers

### 8.1 Internal Testing
1. In TestFlight, go to **Internal Testing**
2. Click **+** to add internal testers
3. Add team members by email
4. Select build and click **Start Testing**

### 8.2 External Testing
1. Go to **External Testing**
2. Click **+** to create new group
3. Fill in:
   - **Group Name**: Beta Testers
   - **Description**: External beta testers
4. Add testers by email
5. Select build and click **Start Testing**

### 8.3 Share TestFlight Link
1. Once approved, you'll get a TestFlight link
2. Share this link with your testers
3. Testers can install via TestFlight app

## Step 9: Monitor and Iterate

### 9.1 View Test Results
- Check **TestFlight** tab for crash reports
- Review tester feedback
- Monitor analytics

### 9.2 Update App
1. Make changes to your app
2. Increment build number
3. Repeat steps 5-8 for new version

## Troubleshooting

### Common Issues

**❌ Code Signing Errors**
- Ensure Apple Developer account is active
- Check bundle ID matches App Store Connect
- Verify certificates are valid

**❌ Upload Failures**
- Check internet connection
- Ensure app is properly archived
- Try uploading via Xcode again

**❌ TestFlight Rejection**
- Review Apple's feedback
- Fix any issues mentioned
- Resubmit for review

**❌ Build Errors**
- Clean build folder (Product → Clean Build Folder)
- Delete derived data
- Rebuild project

### Getting Help

- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [TestFlight Help](https://developer.apple.com/testflight/)
- [App Store Connect Help](https://developer.apple.com/help/app-store-connect/)

## Quick Reference Commands

```bash
# Setup
./scripts/ios-setup.sh

# Build and open
npm run ios:open

# Archive in Xcode
Product → Archive

# Upload via Xcode
Distribute App → App Store Connect → Upload
```

## Timeline

- **Setup**: 1-2 hours
- **Apple Developer Approval**: 24-48 hours
- **Beta Review**: 24-48 hours
- **Total Time**: 2-4 days

Your app will be ready for beta testing once approved! 🎉
