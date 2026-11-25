package com.atlassolucoes.sentinela

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import com.atlassolucoes.sentinela.logica.*
import org.json.JSONObject

/**
 * Ponte site ↔ Android (window.AtlasNativo). O Android expõe a ponte a qualquer página do WebView,
 * então CADA função confere antes se a página aberta é o nosso site (PonteRegras.origemPermitida).
 * O token nunca vai para log nem para o diagnóstico.
 */
class Ponte(private val act: Activity) {
    /** Endereço da página principal aberta agora (atualizado pelo WebViewClient, na thread da tela). */
    @Volatile var urlAtual: String? = null

    private fun ok() = PonteRegras.origemPermitida(urlAtual)

    @JavascriptInterface fun versao(): String = "1"

    @JavascriptInterface fun abrirVigia() {
        if (!ok()) return
        act.runOnUiThread { act.startActivity(Intent(act, VigiaActivity::class.java)) }
    }

    /** {"ativo":bool,"pronto":bool,"falta":"texto"} para o item Vigia nos Ajustes do site. */
    @JavascriptInterface fun estadoVigia(): String {
        if (!ok()) return "{}"
        val a = Armazem(act)
        val e = Etapas.proxima(situacaoVigia(act))
        return JSONObject().put("ativo", a.vigiaAtivo).put("pronto", e == Etapa.PRONTO).put("falta", rotuloFalta(e)).toString()
    }

    /** O site entrou na família: o vigia usa o mesmo token (um convite só). */
    @JavascriptInterface fun usarToken(t: String?) {
        if (!ok() || !PonteRegras.tokenValido(t)) return
        val a = Armazem(act)
        if (a.token == t && !a.desconectado) return
        a.token = t; a.desconectado = false
        if (a.vigiaAtivo) Thread { try { Servidor.atualizarConfig(act.applicationContext) } catch (e: Exception) { } }.start()
    }

    /** Salva um arquivo (relatório PDF, cópia de segurança) em Downloads. Devolve "ok" ou a mensagem de erro. */
    @JavascriptInterface fun salvarArquivo(nome: String?, tipo: String?, base64: String?): String {
        if (!ok() || base64 == null) return "Não permitido."
        val mime = when {
            tipo == "application/pdf" || tipo == "application/json" || tipo == "text/plain" -> tipo
            tipo != null && tipo.startsWith("image/") -> tipo
            else -> "application/octet-stream"
        }
        if (Build.VERSION.SDK_INT < 29) return "Neste Android, baixe pelo navegador."
        return try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val valores = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, PonteRegras.nomeArquivo(nome))
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            val r = act.contentResolver
            val uri = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores) ?: return "Não consegui criar o arquivo."
            r.openOutputStream(uri)?.use { it.write(bytes) } ?: return "Não consegui gravar o arquivo."
            act.runOnUiThread {
                Toast.makeText(act, "Salvo em Downloads", Toast.LENGTH_LONG).show()
                try {
                    act.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                } catch (e: Exception) { /* sem app para abrir: fica em Downloads */ }
            }
            "ok"
        } catch (e: Exception) { "Erro ao salvar: " + (e.message ?: "desconhecido") }
    }
}
