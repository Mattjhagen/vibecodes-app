# TestFlight Deployment Checklist ✅

## Pre-Deployment Setup

### Apple Developer Account
- [ ] Apple Developer Account created ($99/year)
- [ ] Account approved and active
- [ ] App ID created: `com.vibecodes.app`
- [ ] App Store Connect access confirmed

### Development Environment
- [ ] Xcode 15.0+ installed
- [ ] CocoaPods installed (`gem install cocoapods`)
- [ ] iOS dependencies installed (`pod install`)
- [ ] Web app built (`npm run build`)

## Step 1: App Store Connect Setup
- [ ] Go to [App Store Connect](https://appstoreconnect.apple.com)
- [ ] Create new app: **VibeCodes**
- [ ] Bundle ID: `com.vibecodes.app`
- [ ] SKU: `vibecodes-ios`
- [ ] Fill in app information
- [ ] Upload required screenshots
- [ ] Set app category and metadata

## Step 2: Xcode Configuration
- [ ] Open project: `npm run ios:open`
- [ ] Select **App** target
- [ ] **Signing & Capabilities**:
  - [ ] Team: Your Apple Developer Team
  - [ ] Bundle Identifier: `com.vibecodes.app`
  - [ ] Signing: Automatic
- [ ] **General** tab:
  - [ ] Version: `1.0`
  - [ ] Build: `1`
  - [ ] Deployment Target: iOS 17.0+

## Step 3: Build and Archive
- [ ] Select **Any iOS Device (arm64)**
- [ ] **Product** → **Archive**
- [ ] Wait for build completion
- [ ] Organizer opens automatically

## Step 4: Validate and Upload
- [ ] Select archive in Organizer
- [ ] **Validate App** → **App Store Connect**
- [ ] Fix any validation errors
- [ ] **Distribute App** → **App Store Connect**
- [ ] **Upload** → **Automatically manage signing**
- [ ] Wait for upload success

## Step 5: TestFlight Configuration
- [ ] Go to App Store Connect → **TestFlight**
- [ ] Find uploaded build
- [ ] **Add Build Information**:
  - [ ] What to Test: Feature description
  - [ ] Test Details: Instructions
  - [ ] Feedback Email: Your email
- [ ] **Submit for Review**

## Step 6: Add Testers
### Internal Testing
- [ ] Go to **Internal Testing**
- [ ] Add team members by email
- [ ] Select build
- [ ] **Start Testing**

### External Testing
- [ ] Go to **External Testing**
- [ ] Create new group: "Beta Testers"
- [ ] Add external testers by email
- [ ] Select build
- [ ] **Start Testing**

## Step 7: Monitor and Iterate
- [ ] Check for Apple's beta review approval
- [ ] Share TestFlight link with testers
- [ ] Monitor crash reports and feedback
- [ ] Plan next version updates

## Troubleshooting Checklist

### If Build Fails
- [ ] Clean build folder (Product → Clean Build Folder)
- [ ] Delete derived data
- [ ] Check bundle ID matches App Store Connect
- [ ] Verify signing certificates

### If Upload Fails
- [ ] Check internet connection
- [ ] Verify Apple Developer account status
- [ ] Try uploading again
- [ ] Check for validation errors

### If TestFlight Rejected
- [ ] Read Apple's feedback email
- [ ] Fix mentioned issues
- [ ] Resubmit for review
- [ ] Contact Apple if needed

## Success Indicators
- [ ] Archive builds successfully
- [ ] Upload completes without errors
- [ ] Build appears in App Store Connect
- [ ] Beta review approved
- [ ] Testers can install via TestFlight

## Timeline Expectations
- **Setup**: 1-2 hours
- **Apple Review**: 24-48 hours
- **Beta Review**: 24-48 hours
- **Total**: 2-4 days

## Quick Commands Reference
```bash
# Setup
./scripts/ios-setup.sh

# Build and open
npm run ios:open

# In Xcode: Product → Archive
# In Xcode: Distribute App → App Store Connect
```

## Support Resources
- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [TestFlight Help](https://developer.apple.com/testflight/)
- [App Store Connect Help](https://developer.apple.com/help/app-store-connect/)

---

**Note**: Keep this checklist handy during deployment. Each step builds on the previous one, so don't skip ahead!
