import { SidebarTrigger } from '@/components/ui/sidebar';
import { AuthButton } from '../auth/auth-button';
import { ThemeToggle } from '../theme-toggle';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/auth-context';
import { GithubIcon } from 'lucide-react';
import { CloudflareLogo } from '../icons/logos';

export function GlobalHeader() {
	const { user } = useAuth();

	return (
		<motion.header
			initial={{ y: -10, opacity: 0 }}
			animate={{ y: 0, opacity: 1 }}
			transition={{ duration: 0.2, ease: 'easeOut' }}
			className="sticky top-0 z-50"
		>
			<div className="relative">
				{/* Subtle gradient accent */}
				<div className="absolute inset-0" />

				{/* Main content - thinner height */}
				<div className="relative flex items-center justify-between px-5 h-12">
					{/* Left section */}
					{user ? (
						<motion.div
							whileTap={{ scale: 0.95 }}
							transition={{
								type: 'spring',
								stiffness: 400,
								damping: 17,
							}}
							className='flex items-center'
						>
							<SidebarTrigger className="h-8 w-8 text-text-primary rounded-md hover:bg-orange-50/40 transition-colors duration-200" />
							<CloudflareLogo
								className="flex-shrink-0 mx-auto transition-all duration-300"
								style={{
									width: '28px' ,
									height: '28px',
									marginLeft: '8px',
								}}
							/>
						</motion.div>
					) : (
						<div></div>
					)}

					{/* Right section */}
					<motion.div
						initial={{ opacity: 0, x: 10 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ delay: 0.2 }}
						className="flex items-center gap-2"
					>
						<div className="gap-6 flex flex-col justify-between border px-4 bg-bg-4 dark:bg-bg-2 rounded-md py-2 border-accent/50 dark:border-accent/50 !border-t-transparent rounded-t-none mr-12">
							<div className="flex w-full gap-2 items-center">
								<div className='text-text-primary/80 mr-4 text-2xl font-medium'>Deploy your own vibe-coding platform</div>
								<div className="flex font-semibold gap-2 items-center bg-accent dark:bg-accent text-white rounded px-2 hover:opacity-80 cursor-pointer" onClick={() => window.open("https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/vibesdk", "_blank")}>
									Deploy <CloudflareLogo className='w-5 h-5' color1='#fff'  />
								</div>
								<div className="flex font-semibold items-center bg-text-primary text-bg-4 rounded gap-1 px-2 hover:opacity-80 cursor-pointer" onClick={() => window.open("https://github.com/cloudflare/vibesdk", "_blank")} >
									Fork <GithubIcon className="size-4" />
								</div>
							</div>
						</div>
                        {/* Disable cost display for now */}
						{/* {user && (
							<CostDisplay
								{...extractUserAnalyticsProps(analytics)}
								loading={analyticsLoading}
								variant="inline"
							/>
						)} */}
						<ThemeToggle />
						<AuthButton />
					</motion.div>
				</div>
			</div>
		</motion.header>
	);
}
