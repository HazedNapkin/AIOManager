import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { processImageFile, formatFileSize, type ProcessImageOptions } from '@/lib/image-upload'
import { toast } from '@/hooks/use-toast'

interface ImageUploadButtonProps {
    onUploaded: (dataUrl: string) => void
    options: ProcessImageOptions
    className?: string
    label?: string
    children?: React.ReactNode
}

export function ImageUploadButton({ onUploaded, options, className, label, children }: ImageUploadButtonProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [processing, setProcessing] = useState(false)

    const handleFile = async (file: File) => {
        if (file.size > 8 * 1024 * 1024) {
            toast({ variant: 'destructive', title: 'File too large', description: `Max 8 MB, got ${formatFileSize(file.size)}.` })
            return
        }

        setProcessing(true)
        try {
            const result = await processImageFile(file, options)
            onUploaded(result.dataUrl)
            toast({ title: 'Image uploaded', description: `${formatFileSize(result.size)} ${result.mime.split('/')[1].toUpperCase()}` })
        } catch (err) {
            toast({ variant: 'destructive', title: 'Upload failed', description: err instanceof Error ? err.message : 'Unknown error' })
        } finally {
            setProcessing(false)
        }
    }

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFile(file)
                    e.target.value = ''
                }}
            />
            <button
                type="button"
                disabled={processing}
                onClick={() => inputRef.current?.click()}
                className={className}
                title={label || 'Upload image'}
            >
                {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children || <Upload className="h-3.5 w-3.5" />}
            </button>
        </>
    )
}
