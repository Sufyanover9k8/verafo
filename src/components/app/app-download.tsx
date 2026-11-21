import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * The Android build, offered from the dashboard itself.
 *
 * A merchant reading the dashboard on a laptop is the exact person who has a
 * phone in their pocket, so the code is the primary control and the button is
 * the fallback for anyone on a tablet or a desktop browser.
 *
 * The link is the short `/app` route (see `vercel.json`), never the storage URL:
 * the artifact can be rebuilt and republished, and every QR already printed or
 * photographed keeps working.
 */
export const APP_DOWNLOAD_PATH = '/app'

export function AppDownload() {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-wrap items-center gap-5 py-5 sm:gap-6 sm:py-6">
        <img
          src="/qr-app.svg"
          alt="QR code to download the Verafo Android app"
          width={112}
          height={112}
          loading="lazy"
          className="size-28 shrink-0 rounded-[12px] border bg-white p-1.5"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Verafo on your phone</div>
          <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
            Scan the code with your Android camera to install the order desk: clear new orders, call
            buyers and upload a courier file from anywhere. Same account, same risk scores.
          </p>
        </div>
        <Button asChild variant="outline" className="h-11 shrink-0 gap-1.5 px-4 md:h-9">
          <a href={APP_DOWNLOAD_PATH}>
            <Download className="size-4" />
            Download APK
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}
