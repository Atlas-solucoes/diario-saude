package com.atlassolucoes.sentinela

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.security.MessageDigest

/** Tela única do Sentinela: situação de cada coisa (✅/⚠️) e os botões para arrumar. Letras grandes, sem jargão. */
class MainActivity : Activity() {
    private lateinit var caixa: LinearLayout
    private val principal = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val rolar = ScrollView(this)
        caixa = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 60, 40, 80) }
        rolar.addView(caixa)
        setContentView(rolar)
    }

    override fun onResume() { super.onResume(); desenhar() }

    private fun texto(t: String, tam: Float = 18f, negrito: Boolean = false, cor: Int = Color.rgb(14, 44, 94)) =
        TextView(this).apply { text = t; textSize = tam; setTextColor(cor); setPadding(0, 12, 0, 12); if (negrito) setTypeface(null, Typeface.BOLD) }

    private fun botao(t: String, acao: () -> Unit) = Button(this).apply {
        text = t; textSize = 18f; isAllCaps = false; minHeight = 140; setOnClickListener { acao() }
    }

    private fun linha(ok: Boolean, t: String) = texto((if (ok) "✅ " else "⚠️ ") + t, 18f)

    private fun emSegundoPlano(trabalho: () -> String?) {
        Thread {
            val msg = try { trabalho() } catch (e: Exception) { "Erro: " + (e.message ?: "desconhecido") }
            principal.post { desenhar(); if (msg != null) caixa.addView(texto(msg, 18f, true), 1) }
        }.start()
    }

    @SuppressLint("BatteryLife")
    private fun desenhar() {
        caixa.removeAllViews()
        val a = Armazem(this)
        caixa.addView(texto("🛡️ Atlas Saúde Sentinela", 26f, true))
        caixa.addView(texto("Repassa por SMS os alarmes do app da Abbott para a família, mesmo sem internet. Os alarmes do app da Abbott continuam sendo os principais.", 16f))

        val notif = temAcessoNotificacoes(this)
        val sms = checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
        val pm = getSystemService(PowerManager::class.java)
        val bateria = pm.isIgnoringBatteryOptimizations(packageName)
        val cfg = a.config()

        caixa.addView(texto("Situação", 22f, true))
        caixa.addView(linha(notif, if (notif) "Lendo as notificações" else "Falta dar acesso às notificações"))
        caixa.addView(linha(sms, if (sms) "Pode enviar SMS" else "Falta permitir SMS"))
        caixa.addView(linha(bateria, if (bateria) "Fora da economia de bateria" else "Tirar da economia de bateria"))
        caixa.addView(linha(a.token != null && !a.desconectado, when {
            a.token == null -> "Ainda não entrou na família"
            a.desconectado -> "Desconectado da família (usando a última configuração)"
            else -> "Conectado à família"
        }))
        caixa.addView(linha(cfg != null, if (cfg == null) "Configuração das mensagens ainda não baixada" else "Configuração baixada (versão ${cfg.versao})"))
        if (cfg != null) {
            val nomes = cfg.nomesAlerta()
            caixa.addView(texto("Recebem os alertas: " + (if (nomes.isEmpty()) "ninguém" else nomes.joinToString(", ")), 17f))
            caixa.addView(texto("\"Tudo funcionando\": " + (if (cfg.vidaHoras == 0) "desligado" else "a cada ${cfg.vidaHoras} h"), 17f))
        }
        val ult = a.ultimaLeitura()
        caixa.addView(texto("Última leitura vista: " + (ult?.let { "${it.first.valor} mg/dL às ${hora(it.second)}" } ?: "nenhuma ainda"), 17f))
        caixa.addView(texto("Último alarme repassado: " + a.ultimoRepasse.ifEmpty { "nenhum ainda" }, 17f))
        if (a.aviso.isNotEmpty()) caixa.addView(texto("ℹ️ " + a.aviso, 16f))

        caixa.addView(texto("Arrumar", 22f, true))
        if (!notif) {
            caixa.addView(texto("No Android 15: se aparecer \"configuração restrita\", vá em Configurações → Apps → Atlas Saúde Sentinela → ⋮ → Permitir configurações restritas, e volte aqui.", 15f))
            caixa.addView(botao("Dar acesso às notificações") { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) })
        }
        if (!sms) caixa.addView(botao("Permitir SMS") {
            val perms = if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.SEND_SMS, Manifest.permission.POST_NOTIFICATIONS) else arrayOf(Manifest.permission.SEND_SMS)
            requestPermissions(perms, 1)
        })
        if (!bateria) caixa.addView(botao("Tirar da economia de bateria") {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        })
        if (a.token == null || a.desconectado) {
            val cod = EditText(this).apply { hint = "Código do convite (ex.: ABCD-2345)"; textSize = 20f; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS }
            caixa.addView(texto("Peça ao responsável um convite para \"Filha\" no Atlas Saúde (Ajustes → Família conectada).", 15f))
            caixa.addView(cod)
            caixa.addView(botao("Entrar na família") { val c = cod.text.toString(); emSegundoPlano { Servidor.entrar(this, c) } })
        } else {
            caixa.addView(botao("Atualizar configuração agora") { emSegundoPlano { Servidor.atualizarConfig(this) ?: "Configuração atualizada." } })
        }
        if (cfg != null && sms) caixa.addView(botao("Enviar SMS de teste para quem recebe os alertas") {
            val tels = cfg.telefonesAlerta()
            if (tels.isEmpty()) emSegundoPlano { "Ninguém marcado para receber alertas." }
            else emSegundoPlano { tels.forEach { Sms.enviar(this, it, com.atlassolucoes.sentinela.logica.Mensagens.teste(), contarNoTeto = true) }; "SMS de teste enviado para ${tels.size} pessoa(s)." }
        })

        caixa.addView(texto("Diagnóstico (só neste celular, apaga em 24 h)", 20f, true))
        val diag = a.diagnostico()
        caixa.addView(texto(if (diag.isEmpty()) "Nenhuma notificação da Abbott vista ainda." else diag.takeLast(20).reversed().joinToString("\n"), 13f))
        caixa.addView(texto("Verificação automática: " + (if (a.verificadorMs == 0L) "ainda não rodou" else "última às ${hora(a.verificadorMs)}"), 14f))
        caixa.addView(texto("Assinatura do app (confira com a do GitHub): " + impressao(), 12f, cor = Color.GRAY).apply { setTextIsSelectable(true) })
        caixa.addView(View(this).apply { minimumHeight = 80 })
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults); desenhar()
    }

    /** Impressão SHA-256 do certificado que assinou este app (para conferir com a publicada no GitHub). */
    @Suppress("DEPRECATION")
    private fun impressao(): String = try {
        val assinaturas = if (Build.VERSION.SDK_INT >= 28) {
            packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
        } else packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES).signatures
        val bytes = assinaturas?.firstOrNull()?.toByteArray() ?: ByteArray(0)
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(":") { "%02X".format(it) }
    } catch (e: Exception) { "indisponível" }
}
