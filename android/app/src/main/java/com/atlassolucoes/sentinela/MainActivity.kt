package com.atlassolucoes.sentinela

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.atlassolucoes.sentinela.logica.PonteRegras

/** Tela principal: o Atlas Saúde de sempre (o site publicado) dentro do app, com a ponte para o vigia. */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var ponte: Ponte
    private var escolha: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val raiz = FrameLayout(this).apply { fitsSystemWindows = true; setBackgroundColor(Cores.FUNDO) }
        web = WebView(this)
        raiz.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(raiz)

        web.setBackgroundColor(Cores.FUNDO)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
        }
        ponte = Ponte(this)
        web.addJavascriptInterface(ponte, "AtlasNativo")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val url = req.url.toString()
                if (PonteRegras.origemPermitida(url)) return false
                // fora do nosso site: abre no navegador (só http/https/tel/mailto), nunca dentro do app
                val esquema = req.url.scheme ?: ""
                if (esquema in listOf("https", "http", "tel", "mailto")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, req.url)) } catch (e: Exception) { }
                }
                return true
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) { ponte.urlAtual = url }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) { ponte.urlAtual = url }
            override fun onReceivedError(view: WebView, req: WebResourceRequest, erro: WebResourceError) {
                if (req.isForMainFrame) {
                    ponte.urlAtual = null
                    view.loadDataWithBaseURL(null, PAGINA_SEM_INTERNET, "text/html", "utf-8", null)
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                escolha?.onReceiveValue(null)
                escolha = cb
                return try { startActivityForResult(p.createIntent(), ESCOLHER); true }
                catch (e: Exception) { escolha = null; false }
            }
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        if (web.url == null) web.loadUrl(PonteRegras.SITE)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        // volta do Vigia/Configurações: o site atualiza o ✅/⚠️ do item Vigia
        web.evaluateJavascript("window.dispatchEvent(new Event('atlasnativo'))", null)
    }

    override fun onPause() { web.onPause(); super.onPause() }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }

    @Deprecated("Activity simples")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == ESCOLHER) {
            escolha?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            escolha = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Activity simples")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    companion object {
        private const val ESCOLHER = 7
        private val PAGINA_SEM_INTERNET = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="font-family:sans-serif;background:#F4F8FB;color:#12212B;text-align:center;padding:48px 24px">
            <div style="font-size:64px">📶</div>
            <h2 style="color:#0E2C5E">Sem internet agora</h2>
            <p style="font-size:18px">Na primeira vez, o Atlas Saúde precisa de internet para abrir. Depois funciona sem.</p>
            <p style="font-size:18px">O vigia dos alarmes continua funcionando por SMS.</p>
            <p><a href="${PonteRegras.SITE}" style="display:inline-block;background:#17458F;color:#fff;padding:16px 28px;border-radius:16px;text-decoration:none;font-size:18px;font-weight:bold">Tentar de novo</a></p>
            </body></html>
        """.trimIndent()
    }
}
