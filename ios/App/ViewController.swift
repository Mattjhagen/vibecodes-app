import UIKit
import WebKit

class ViewController: UIViewController {
    
    @IBOutlet weak var webView: WKWebView!
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Configure the web view
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.allowsInlineMediaPlayback = true
        webConfiguration.mediaTypesRequiringUserActionForPlayback = []
        
        // Create web view programmatically if not connected via storyboard
        if webView == nil {
            let newWebView = WKWebView(frame: view.bounds, configuration: webConfiguration)
            newWebView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(newWebView)
            self.webView = newWebView
        }
        
        // Load the web app
        if let url = URL(string: "https://vibecodes.app") {
            let request = URLRequest(url: url)
            webView?.load(request)
        }
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        
        // Hide navigation bar for full-screen experience
        navigationController?.setNavigationBarHidden(true, animated: animated)
    }
    
    override var prefersStatusBarHidden: Bool {
        return false
    }
    
    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .default
    }
}
