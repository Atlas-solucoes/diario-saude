package com.atlassolucoes.sentinela

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
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

    /** 🆘 "Não estou bem" (celular da paciente): SMS para quem recebe os alertas, sem internet, sem freios
     *  (só a trava de 2 min). Devolve {"ok":true,"avisados":n} ou {"ok":false,"motivo":"..."} — aí o site abre o SMS pronto. */
    @JavascriptInterface fun emergencia(): String = avisar(true)
    @JavascriptInterface fun estouBem(): String = avisar(false)

    private fun avisar(pedido: Boolean): String {
        fun nao(m: String) = JSONObject().put("ok", false).put("motivo", m).toString()
        if (!ok()) return nao("Não permitido.")
        val a = Armazem(act)
        val agora = System.currentTimeMillis()
        if (!a.vigiaAtivo) return nao("O vigia está desligado neste celular, então o SMS não sai sozinho.")
        if (act.checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) return nao("O app está sem permissão de SMS.")
        val cfg = a.config() ?: return nao("A configuração das mensagens ainda não chegou a este celular.")
        val tels = cfg.telefonesAlerta()
        if (tels.isEmpty()) return nao("Ninguém está marcado para receber os alertas.")
        if (pedido && !Emergencia.podePedir(a.emergenciaMs, agora)) return JSONObject().put("ok", false).put("espera", true).toString()
        val msg = if (pedido) Mensagens.emergencia(hora(agora)) else Mensagens.estouBem(hora(agora))
        tels.forEach { Sms.enviar(act.applicationContext, it, msg, contarNoTeto = false) } // sem sinal: vai para a fila e tenta de novo
        if (pedido) a.emergenciaMs = agora
        return JSONObject().put("ok", true).put("avisados", tels.size).toString()
    }

    /** O diário recebeu configuração nova da família: o vigia busca na hora (não espera os 15 min). */
    @JavascriptInterface fun configMudou() {
        if (!ok()) return
        val ctx = act.applicationContext
        if (Armazem(ctx).vigiaAtivo) Thread { try { Servidor.atualizarConfig(ctx) } catch (e: Exception) { } }.start()
    }

    /** Atalho "🆘 Não estou bem" ao segurar o ícone do app: só no celular da paciente. */
    @JavascriptInterface fun atalhoEmergencia(ligar: Boolean) {
        if (!ok()) return
        try {
            val sm = act.getSystemService(ShortcutManager::class.java) ?: return
            if (!ligar) { sm.removeDynamicShortcuts(listOf("sos")); return }
            val i = Intent(act, MainActivity::class.java).setAction(MainActivity.ACAO_EMERGENCIA)
            val atalho = ShortcutInfo.Builder(act, "sos").setShortLabel("🆘 Não estou bem").setLongLabel("🆘 Não estou bem: pedir ajuda")
                .setIcon(Icon.createWithResource(act, R.mipmap.ic_launcher)).setIntent(i).build()
            sm.dynamicShortcuts = listOf(atalho)
        } catch (e: Exception) { /* lançador sem atalhos: ignora */ }
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
