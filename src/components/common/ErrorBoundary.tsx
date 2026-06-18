import { Component, ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw, Home, Copy, Check } from 'lucide-react'
import pkg from '../../../package.json'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
    errorInfo: ErrorInfo | null
    copied: boolean
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
        copied: false,
    }

    public static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error }
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo)
        this.setState({ errorInfo })
    }

    private handleCopyError = () => {
        const { error, errorInfo } = this.state
        const text = [
            `AIOManager v${pkg.version}`,
            `URL: ${window.location.href}`,
            `UA: ${navigator.userAgent}`,
            ``,
            `Error: ${error?.message}`,
            ``,
            `Stack:`,
            error?.stack || '(no stack)',
            ``,
            `Component Stack:`,
            errorInfo?.componentStack || '(none)',
        ].join('\n')

        navigator.clipboard.writeText(text).then(() => {
            this.setState({ copied: true })
            setTimeout(() => this.setState({ copied: false }), 2000)
        }).catch((copyError) => {
            if (import.meta.env.DEV) console.error('[ErrorBoundary] Failed to copy error report:', copyError)
        })
    }

    private handleReset = () => {
        // Direct browser navigation is safest during a UI crash
        window.location.href = '/'
    }

    private handleReload = () => {
        // Hard browser reload to clear memory and hung states
        window.location.reload()
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-background flex items-center justify-center p-4">
                    <section
                        className="max-w-lg w-full rounded-xl border border-border/40 bg-card p-6 text-center shadow-sm animate-in fade-in zoom-in-95 duration-300 sm:p-8"
                        aria-labelledby="error-boundary-title"
                    >
                        <div className="flex justify-center">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-destructive/20 bg-destructive/10">
                                <AlertTriangle className="h-7 w-7 text-destructive" />
                            </div>
                        </div>

                        <div className="mt-6 space-y-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase">Recovery</p>
                            <h1 id="error-boundary-title" className="text-2xl font-bold tracking-tight">
                                Something went wrong.
                            </h1>
                            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                                AIOManager hit a UI crash. Your saved data remains intact; reload to retry.
                            </p>
                        </div>

                        {this.state.error && (
                            <div className="mt-6 space-y-3 overflow-hidden rounded-lg border border-border/40 bg-muted/20 p-4 text-left">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Error detail</p>
                                    <Button
                                        onClick={this.handleCopyError}
                                        variant="outline"
                                        size="sm"
                                        className="rounded-full"
                                    >
                                        {this.state.copied
                                            ? <><Check className="h-3 w-3 text-success" /> Copied</>
                                            : <><Copy className="h-3 w-3" /> Copy for support</>
                                        }
                                    </Button>
                                </div>
                                <p className="break-all font-mono text-xs leading-relaxed text-destructive">
                                    {this.state.error.message}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Copy this error and share it on GitHub - it helps us fix issues faster.
                                </p>
                            </div>
                        )}

                        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                            <Button
                                onClick={this.handleReload}
                                className="w-full h-11 rounded-full gap-2 sm:w-auto"
                            >
                                <RefreshCw className="h-4 w-4" />
                                Reload app
                            </Button>
                            <Button
                                variant="outline"
                                onClick={this.handleReset}
                                className="w-full h-11 rounded-full gap-2 sm:w-auto"
                            >
                                <Home className="h-4 w-4" />
                                Return home
                            </Button>
                        </div>

                        <span className="mt-6 block text-xs text-muted-foreground">
                            AIOManager v{pkg.version}{(pkg as { build?: number }).build ? ` · Build ${(pkg as { build?: number }).build}` : ''}
                        </span>
                    </section>
                </div>
            )
        }

        return this.props.children
    }
}
