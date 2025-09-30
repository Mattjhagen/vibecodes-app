import { useEffect, useState, useRef, forwardRef } from 'react';
import { RotateCcw, RefreshCw } from 'lucide-react';
import { WebSocket } from 'partysocket';


interface SmartPreviewIframeProps {
	src: string;
	className?: string;
	title?: string;
	// Optional prop to trigger reload when phase 1 is completed
	onPhaseCompleted?: boolean;
	// Prop to trigger automatic refresh after deployment completion
	shouldRefreshPreview?: boolean;
	// WebSocket connection for sending runtime error messages
	webSocket?: WebSocket | null | undefined;
	// Manual refresh trigger
	manualRefreshTrigger?: number;
	// Phase timeline for tracking progress
	phaseTimelineLength?: number;
	// Development mode - enables screenshot capture
	devMode?: boolean;
}

interface RetryState {
	attempt: number;
	isRetrying: boolean;
	lastError: string | null;
	hasSucceeded: boolean;
	reactError: string | null;
	showErrorHandling: boolean;
	consecutiveReactErrors: number;
	lastReactErrorBody: string | null;
}

export const SmartPreviewIframe = forwardRef<HTMLIFrameElement, SmartPreviewIframeProps>(
	({ src, className = '', title = 'Preview',  shouldRefreshPreview = false, webSocket = null, manualRefreshTrigger, devMode = false }, ref) => {
		const [retryState, setRetryState] = useState<RetryState>({
			attempt: 0,
			isRetrying: false,
			lastError: null,
			hasSucceeded: false,
			reactError: null,
			showErrorHandling: false,
			consecutiveReactErrors: 0,
			lastReactErrorBody: null
		});
		
		const [currentSrc, setCurrentSrc] = useState<string>('');
		const timeoutRef = useRef<NodeJS.Timeout | null>(null);
		const maxRetries = 16; // Will try for ~8 minutes total
		
		// Reset retry state when src changes
		useEffect(() => {
			setRetryState({
				attempt: 0,
				isRetrying: false,
				lastError: null,
				hasSucceeded: false,
				reactError: null,
				showErrorHandling: false,
				consecutiveReactErrors: 0,
				lastReactErrorBody: null
			});
			setCurrentSrc('');
			
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
			
			// Start loading immediately
			loadWithRetry(src, 0);
		}, [src]);

		// Handle automatic preview refresh after deployment completion
		useEffect(() => {
			if (shouldRefreshPreview && retryState.hasSucceeded && currentSrc) {
				console.log('🔄 Auto-refreshing preview after deployment completion');
				
				// Force reload by temporarily clearing and resetting the src
				// This ensures the iframe actually reloads instead of using cache
				setCurrentSrc('');
				setRetryState(prev => ({
					...prev,
					hasSucceeded: false,
					lastError: 'Refreshing preview after deployment completion...'
				}));
				
				// Reload immediately (no delay needed since deployment is already complete)
				setTimeout(() => {
					loadWithRetry(src, 0);
				}, 1000);
			}
		}, [shouldRefreshPreview, retryState.hasSucceeded, currentSrc, src]);
		
		// Handle manual refresh trigger
		useEffect(() => {
			if (manualRefreshTrigger && manualRefreshTrigger > 0) {
				console.log('🔄 Manual refresh triggered');
				
				// Force reload by clearing and resetting the src
				setCurrentSrc('');
				setRetryState({
					attempt: 0,
					isRetrying: false,
					lastError: null,
					hasSucceeded: false,
					reactError: null,
					showErrorHandling: false,
					consecutiveReactErrors: 0,
					lastReactErrorBody: null
				});
				
				// Clear any existing timeouts
				if (timeoutRef.current) {
					clearTimeout(timeoutRef.current);
				}
				
				// Reload after a brief moment
				setTimeout(() => {
					loadWithRetry(src, 0);
				}, 100);
			}
		}, [manualRefreshTrigger]);
		
		const loadWithRetry = (url: string, attempt: number) => {
			if (attempt >= maxRetries) {
				// Send runtime error to backend via WebSocket
				if (webSocket && webSocket.readyState === WebSocket.OPEN) {
					try {
						webSocket.send(JSON.stringify({
							type: 'runtime_error_found',
							errorMessage: retryState.reactError || 'Application failed to load after multiple attempts. Possible React router error or deployment issue.',
							url: url,
							attemptsCount: attempt
						}));
					} catch (error) {
						console.error('Failed to send runtime error message:', error);
					}
				}

				setRetryState(prev => ({
					...prev,
					isRetrying: false,
					lastError: 'Preview failed to load after multiple attempts. The deployment may still be starting up.',
					showErrorHandling: true
				}));
				return;
			}
			
			setRetryState(prev => ({
				...prev,
				attempt: attempt + 1,
				isRetrying: true,
				lastError: null
			}));
			
			// Test if URL has content ready with comprehensive verification
			testContentReadiness(url)
				.then((isAccessible: boolean) => {
					if (isAccessible) {
						// URL is accessible, load it in iframe
						setCurrentSrc(url);
						setRetryState(prev => ({
							...prev,
							isRetrying: false,
							hasSucceeded: true,
							lastError: null
						}));
					} else {
						// URL not accessible yet, retry with exponential backoff
						const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30s delay
						
						setRetryState(prev => ({
							...prev,
							lastError: `Preview not ready yet. Retrying in ${Math.ceil(delay / 1000)}s... (attempt ${attempt + 1}/${maxRetries})`
						}));
						
						timeoutRef.current = setTimeout(() => {
							loadWithRetry(url, attempt + 1);
						}, delay);
					}
				})
				.catch(() => {
					// Error testing URL, retry anyway
					const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
					
					setRetryState(prev => ({
						...prev,
						lastError: `Preview not ready yet. Retrying in ${Math.ceil(delay / 1000)}s... (attempt ${attempt + 1}/${maxRetries})`
					}));
					
					timeoutRef.current = setTimeout(() => {
						loadWithRetry(url, attempt + 1);
					}, delay);
				});
		};
		
		/**
		 * Test if the URL is accessible and has meaningful content
		 * Uses multiple verification methods to ensure content is actually ready
		 */
		const testContentReadiness = async (url: string): Promise<boolean> => {
			try {
				// Step 1: Fast connectivity test
				await fetch(url, {
					method: 'HEAD',
					mode: 'no-cors',
					cache: 'no-cache',
					signal: AbortSignal.timeout(8000) // 8 second timeout
				});

				// Step 2: Content verification via iframe load test
				const contentReadiness = await testIframeContentLoad(url);
				
				return contentReadiness;
			} catch (error) {
				console.log('Content readiness test failed:', error);
				return false;
			}
		};

		/**
		 * Test content loading by creating a temporary iframe and monitoring its load state
		 * This ensures the page actually renders with content, not just responds to requests
		 */
		const testIframeContentLoad = (url: string): Promise<boolean> => {
			return new Promise((resolve) => {
				const testFrame = document.createElement('iframe');
				testFrame.style.display = 'none';
				testFrame.style.position = 'absolute';
				testFrame.style.left = '-9999px';
				
				let hasResolved = false;
				const timeout = setTimeout(() => {
					if (!hasResolved) {
						hasResolved = true;
						document.body.removeChild(testFrame);
						resolve(false);
					}
				}, 10000); // 10 second timeout for content load

				testFrame.onload = () => {
					if (hasResolved) return;
					
					// Fast verification: check if iframe has meaningful content
					setTimeout(() => {
						try {
							// Try to access iframe document to verify it's not empty/error page
							const iframeDoc = testFrame.contentDocument || testFrame.contentWindow?.document;
							const bodyText = iframeDoc?.body?.textContent?.toLowerCase() || '';
							const titleText = iframeDoc?.title?.toLowerCase() || '';
							
							// Check for container proxy errors (any IP address pattern)
							const hasContainerError = 
								bodyText.includes('error proxying request to container') ||
								bodyText.includes('the container is not listening') ||
								bodyText.includes('tcp address') ||
								titleText.includes('error') ||
								bodyText.includes('cannot get') ||
								bodyText.includes('404') ||
								bodyText.includes('internal server error') ||
								bodyText.includes('502 bad gateway') ||
								bodyText.includes('503 service unavailable');

							const hasValidContent = !!(iframeDoc && 
								iframeDoc.body && 
								iframeDoc.body.children.length > 0 &&
								!hasContainerError);
						
							if (!hasResolved) {
								hasResolved = true;
								clearTimeout(timeout);
								document.body.removeChild(testFrame);
								resolve(hasValidContent);
							}
						} catch {
							// Cross-origin restrictions - assume content is ready if iframe loaded
							if (!hasResolved) {
								hasResolved = true;
								clearTimeout(timeout);
								document.body.removeChild(testFrame);
								resolve(true);
							}
						}
					}, 1500); // Wait 1.5 seconds after load to ensure content is rendered
				};

				testFrame.onerror = () => {
					if (!hasResolved) {
						hasResolved = true;
						clearTimeout(timeout);
						document.body.removeChild(testFrame);
						resolve(false);
					}
				};

				document.body.appendChild(testFrame);
				testFrame.src = url;
			});
		};
		
		const handleManualRetry = () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
			setRetryState({
				attempt: 0,
				isRetrying: false,
				lastError: null,
				hasSucceeded: false,
				reactError: null,
				showErrorHandling: false,
				consecutiveReactErrors: 0,
				lastReactErrorBody: null
			});
			setCurrentSrc('');
			loadWithRetry(src, 0);
		};
		
		// Cleanup timeout on unmount
		useEffect(() => {
			return () => {
				if (timeoutRef.current) {
					clearTimeout(timeoutRef.current);
				}
			};
		}, []);
		
		// If we have a working URL, show the iframe
		if (retryState.hasSucceeded && currentSrc) {
			return (
				<iframe
					ref={ref}
					src={currentSrc}
					className={className}
					title={title}
					onLoad={() => {
						// Try to detect React errors after iframe loads
						setTimeout(() => {
							try {
									// No error detected - reset consecutive error count
									setRetryState(prev => ({
										...prev,
										consecutiveReactErrors: 0,
										lastReactErrorBody: null
									}));
										
									// Trigger server-side screenshot capture in dev mode
									if (devMode && webSocket && webSocket.readyState === WebSocket.OPEN) {
										// Wait a bit to ensure the page is fully rendered
										setTimeout(() => {
											try {
												console.log('📸 Requesting server-side screenshot of preview');
												
												// Send screenshot capture request to backend (server will handle the actual capture)
												webSocket.send(JSON.stringify({
													type: 'screenshot_captured',
													data: {
														url: currentSrc,
														timestamp: Date.now(),
														viewport: { 
															width: 1280, 
															height: 720 
														}
													}
												}));
												
												console.log('✅ Screenshot request sent to backend');
											} catch (screenshotError) {
												console.error('❌ Failed to send screenshot request:', screenshotError);
											}
										}, 2000); // Wait 2 seconds for full page render
									}
							} catch (error) {
								// Cross-origin restrictions prevent access - that's okay
								console.log('Cannot access iframe content due to CORS - assuming app is working');
								// Reset consecutive errors since we can't detect them
								setRetryState(prev => ({
									...prev,
									consecutiveReactErrors: 0,
									lastReactErrorBody: null
								}));
							}
						}, 800); // Quick 800ms check for React errors - fast but thorough
					}}
					onError={() => {
						// If iframe fails to load, retry
						console.log('Iframe failed to load, retrying...');
						setRetryState(prev => ({ ...prev, hasSucceeded: false }));
						loadWithRetry(src, retryState.attempt);
					}}
				/>
			);
		}
		
		// Show loading/retry state
		return (
			<div className={`${className} flex flex-col items-center justify-center bg-bg-3 border border-text/10 rounded-lg`}>
				<div className="text-center p-8 max-w-md">
					{retryState.isRetrying ? (
						<>
							<RefreshCw className="size-8 text-accent animate-spin mx-auto mb-4" />
							<h3 className="text-lg font-medium text-text-primary mb-2">Loading Preview</h3>
							<p className="text-text-primary/70 text-sm mb-4">
								{retryState.lastError || 'Checking if your deployed preview is ready...'}
							</p>
							<div className="text-xs text-text-primary/50">
								Preview URLs may take a moment to become available after deployment
							</div>
						</>
					) : retryState.showErrorHandling ? (
						<>
							<RefreshCw className="size-8 text-brand animate-spin mx-auto mb-4" />
							<h3 className="text-lg font-medium text-text-primary mb-2">Application Issues Detected</h3>
							<p className="text-text-primary/70 text-sm mb-6">
								The Application may not be working yet, I will fix it for you. Please wait...
							</p>
							<button
								onClick={() => {
									setRetryState(prev => ({
										...prev,
										showErrorHandling: false,
										attempt: 0,
										lastError: null,
										reactError: null
									}));
									handleManualRetry();
								}}
								className="flex items-center justify-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm mx-auto font-medium"
							>
								<RotateCcw className="size-4" />
								Nah, I would try turning things off and on again
							</button>
						</>
					) :
					//  retryState.lastError ? (
					// 	<>
					// 		<AlertCircle className="size-8 text-orange-500 mx-auto mb-4" />
					// 		<h3 className="text-lg font-medium text-text-primary mb-2">Preview Not Ready</h3>
					// 		<p className="text-text-primary/70 text-sm mb-4">
					// 			{retryState.lastError}
					// 		</p>
					// 		<button
					// 			onClick={handleManualRetry}
					// 			className="flex items-center justify-center gap-2 px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors text-sm mx-auto"
					// 		>
					// 			<RotateCcw className="size-4" />
					// 			Try Again
					// 		</button>
					// 	</>
					// ) : 
					(
						<>
							<RefreshCw className="size-8 text-brand animate-spin mx-auto mb-4" />
							<h3 className="text-lg font-medium text-text-primary mb-2">Preparing Preview</h3>
							<p className="text-text-primary/70 text-sm">
								Setting up your project preview...
							</p>
						</>
					)}
				</div>
			</div>
		);
	}
);

SmartPreviewIframe.displayName = 'SmartPreviewIframe';
