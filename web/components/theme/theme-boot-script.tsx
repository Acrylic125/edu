import Script from "next/script"

import { THEME_STORAGE_KEY } from "@/lib/theme"

/**
 * Runs before hydration so the first paint matches localStorage / system preference.
 * Must use next/script — raw <script> in a React component warns and does not run on the client.
 */
export function ThemeBootScript() {
  const code = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var m=localStorage.getItem(k);if(m!=="light"&&m!=="dark"&&m!=="system")m="system";var dark=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);}catch(e){}})();`

  return (
    <Script id="edu-theme-boot" strategy="beforeInteractive">
      {code}
    </Script>
  )
}
