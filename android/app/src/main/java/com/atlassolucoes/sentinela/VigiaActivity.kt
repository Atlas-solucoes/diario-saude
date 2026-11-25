package com.atlassolucoes.sentinela

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import com.atlassolucoes.sentinela.logica.*
import java.security.MessageDigest

/** Situação do vigia neste celular (usada pela tela e pela ponte com o site). */
fun situacaoVigia(ctx: Context): Situacao {
    val a = Armazem(ctx)
    val pm = ctx.getSystemService(PowerManager::class.java)
    return Situacao(
        comecou = a.vigiaAtivo && a.comecou,
        notificacoes = temAcessoNotificacoes(ctx),
        sms = ctx.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED,
        bateria = pm.isIgnoringBatteryOptimizations(ctx.packageName),
        naFamilia = a.token != null && !a.desconectado,
        testou = a.testouMs != 0L
    )
}

fun rotuloFalta(e: Etapa): String = when (e) {
    Etapa.BOAS_VINDAS -> "Vigia desligado neste celular"
    Etapa.NOTIFICACOES -> "Falta: ver os alarmes (notificações)"
    Etapa.SMS -> "Falta: permitir SMS"
    Etapa.BATERIA -> "Falta: tirar da economia de bateria"
    Etapa.FAMILIA -> "Falta: ligar à família"
    Etapa.TESTE -> "Falta: enviar o SMS de teste"
    Etapa.PRONTO -> "Vigia ligado"
}

/** Vigia: assistente de primeira vez (um passo por tela) e, depois, o painel. */
class VigiaActivity : Activity() {
    private lateinit var caixa: LinearLayout
    private lateinit var rolar: ScrollView
    private val principal = Handler(Looper.getMainLooper())
    private var tentouNotif = false
    private var mensagem: String? = null
    private var detalhes = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        rolar = ScrollView(this).apply { setBackgroundColor(Cores.FUNDO); fitsSystemWindows = true; isFillViewport = true }
        caixa = coluna().apply { setPadding(dp(20), dp(8), dp(20), dp(40)) }
        rolar.addView(caixa)
        setContentView(rolar)
    }

    override fun onResume() {
        super.onResume()
        val a = Armazem(this)
        if (tentouNotif && !temAcessoNotificacoes(this)) a.negadoNotif = true
        tentouNotif = false
        desenhar()
    }

    /* ---------- desenho ---------- */

    private fun desenhar() {
        caixa.removeAllViews()
        val s = situacaoVigia(this)
        val etapa = Etapas.proxima(s)

        // topo: voltar ao diário + título
        caixa.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(link("← Diário") { finish() }.apply { gravity = Gravity.START })
            addView(texto("🛡️ Vigia", 20f, Cores.AZUL_ESCURO, negrito = true).apply {
                gravity = Gravity.END; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
        }, lp(baixo = 6))

        val n = Etapas.numero(etapa)
        if (n > 0) {
            caixa.addView(progresso(n, Etapas.numeradas.size), lp(4))
            caixa.addView(texto("Passo $n de ${Etapas.numeradas.size}", 14f, Cores.SUAVE, negrito = true), lp(8))
        }
        mensagem?.let { m ->
            caixa.addView(cartao(Cores.AZUL_CLARO, Cores.AZUL).apply { addView(texto(m, 16f, Cores.AZUL_ESCURO, negrito = true)) }, lp(10))
        }

        when (etapa) {
            Etapa.BOAS_VINDAS -> boasVindas()
            Etapa.NOTIFICACOES -> passoNotificacoes()
            Etapa.SMS -> passoSms()
            Etapa.BATERIA -> passoBateria()
            Etapa.FAMILIA -> passoFamilia()
            Etapa.TESTE -> passoTeste()
            Etapa.PRONTO -> painel()
        }
    }

    private fun passo(emoji: String, titulo: String, explica: String): LinearLayout {
        val c = cartao()
        c.addView(ilustracao(emoji))
        c.addView(texto(titulo, 24f, Cores.AZUL_ESCURO, negrito = true, centro = true), lp(baixo = 8))
        c.addView(texto(explica, 17f, Cores.SUAVE, centro = true), lp(baixo = 14))
        caixa.addView(c, lp(12))
        return c
    }

    private fun boasVindas() {
        val c = passo("🛡️", "Vigia dos alarmes",
            "Quando o app do sensor (Abbott) der um alarme, o vigia manda um SMS para a família, mesmo sem internet. Os alarmes da Abbott continuam tocando normalmente.")
        c.addView(texto("Este é o celular de quem usa o sensor?", 19f, negrito = true, centro = true), lp(6, 12))
        c.addView(botao("Sim, ligar o vigia") {
            val a = Armazem(this); a.vigiaAtivo = true; a.comecou = true; mensagem = null; desenhar()
        }, lp(4))
        c.addView(botao("Não, só uso o diário", principal = false) { Armazem(this).vigiaAtivo = false; finish() }, lp(12))
    }

    private fun passoNotificacoes() {
        val a = Armazem(this)
        val c = passo("🔔", "Deixar o vigia ver os alarmes",
            "O vigia olha só os avisos do app da Abbott. Não lê mensagens, fotos, nem nada mais.")
        c.addView(botao(if (a.negadoNotif) "Tentar de novo" else "Abrir a permissão") { abrirNotificacoes() }, lp(4))
        c.addView(texto("Na tela que abrir, ligue o Atlas Saúde e volte aqui.", 15f, Cores.SUAVE, centro = true), lp(10))
        if (a.negadoNotif) destravar(incluiSms = false)
        else caixa.addView(link("Apareceu \"Acesso negado\" ou \"configuração restrita\"?") { a.negadoNotif = true; desenhar() }, lp(6))
    }

    private fun passoSms() {
        val a = Armazem(this)
        val c = passo("💬", "Deixar o vigia mandar SMS",
            "Os SMS saem do chip deste celular só para quem foi marcado no diário (Ajustes → Mensagens).")
        c.addView(botao(if (a.negadoSms) "Tentar de novo" else "Permitir SMS") {
            a.pediuSms = true
            requestPermissions(arrayOf(Manifest.permission.SEND_SMS), 1)
        }, lp(4))
        if (a.negadoSms) destravar(incluiSms = true)
        else caixa.addView(link("Apareceu \"Acesso negado\"?") { a.negadoSms = true; desenhar() }, lp(6))
    }

    /** Cartão "o Android travou": leva direto à página do app e mostra onde tocar. */
    private fun destravar(incluiSms: Boolean) {
        val c = cartao(Cores.AMBAR_CLARO, Cores.DOURADO)
        c.addView(texto("🔓 O Android travou? É normal na 1ª vez.", 19f, Cores.AMBAR, negrito = true), lp(baixo = 6))
        c.addView(texto("Ele protege contra golpes. Destrave uma vez só:", 16f, Cores.TEXTO), lp(baixo = 6))
        c.addView(item("1", "Toque em \"Abrir a página do app\" aqui embaixo."))
        c.addView(item("2", "Lá em cima, à direita, toque nos três pontinhos ⋮"))
        c.addView(desenhoTresPontos(), lp(6, 6))
        c.addView(item("3", "Toque em \"Permitir configurações restritas\" e confirme com seu PIN ou digital."))
        if (incluiSms) c.addView(item("4", "Ainda nessa página: Permissões → SMS → Permitir."))
        c.addView(item(if (incluiSms) "5" else "4", "Volte aqui (botão voltar ◁) e toque em \"Tentar de novo\"."))
        c.addView(botao("Abrir a página do app") { abrirPaginaDoApp() }, lp(12))
        caixa.addView(c, lp(12))
    }

    @SuppressLint("BatteryLife")
    private fun passoBateria() {
        val c = passo("🔋", "Não deixar o Android desligar o vigia",
            "Sem isso, o Android pode fechar o vigia para economizar bateria — e o alarme não sai.")
        c.addView(botao("Liberar") {
            abrir(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")),
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }, lp(4))
        c.addView(texto("Na pergunta que aparecer, toque em \"Permitir\".", 15f, Cores.SUAVE, centro = true), lp(10))
    }

    private fun passoFamilia() {
        val a = Armazem(this)
        val c = passo("👨‍👩‍👧", "Ligar à família",
            "Jeito mais fácil: volte ao diário e entre na família com o convite. O vigia liga junto, sozinho.")
        c.addView(botao("Ir para o diário") { finish() }, lp(4))
        if (a.desconectado) c.addView(texto("Este celular foi desconectado da família. Peça um convite novo.", 15f, Cores.AMBAR, negrito = true, centro = true), lp(10))
        c.addView(texto("Ou digite o convite aqui:", 16f, Cores.SUAVE, centro = true), lp(16, 6))
        val campo = EditText(this).apply {
            hint = "ABCD-2345"; textSize = 24f; gravity = Gravity.CENTER; isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            background = forma(Cores.BRANCO, 14, 2, Cores.LINHA); setPadding(dp(12), dp(12), dp(12), dp(12))
            letterSpacing = 0.12f
        }
        c.addView(campo, lp())
        c.addView(botao("Entrar com o convite", principal = false) {
            val cod = Etapas.limparConvite(campo.text.toString())
            if (cod.length != 8) { mensagem = "O convite tem 8 letras e números (ex.: ABCD-2345)."; desenhar() }
            else emSegundoPlano { Servidor.entrar(this, cod) }
        }, lp(10))
    }

    private fun passoTeste() {
        val a = Armazem(this)
        val cfg = a.config()
        val c = passo("📨", "Enviar um SMS de teste", "Para conferir que chega em quem vai receber os alarmes.")
        if (cfg == null) {
            c.addView(texto("A configuração das mensagens ainda não chegou.", 16f, Cores.AMBAR, negrito = true, centro = true), lp(baixo = 10))
            c.addView(botao("Buscar agora") { emSegundoPlano { Servidor.atualizarConfig(this) ?: "Configuração recebida." } })
            return
        }
        val nomes = cfg.nomesAlerta()
        if (nomes.isEmpty()) {
            c.addView(texto("Ninguém está marcado para receber os alarmes. No diário: Ajustes → Mensagens.", 16f, Cores.AMBAR, negrito = true, centro = true), lp(baixo = 10))
            c.addView(botao("Ir para o diário") { finish() })
            c.addView(botao("Já marquei, buscar de novo", principal = false) { emSegundoPlano { Servidor.atualizarConfig(this) ?: "Configuração atualizada." } }, lp(10))
            return
        }
        c.addView(texto("Vai para: " + nomes.joinToString(", "), 17f, Cores.TEXTO, negrito = true, centro = true), lp(baixo = 12))
        c.addView(botao("Enviar SMS de teste") { enviarTeste() })
        c.addView(link("Pular por agora") { a.testouMs = 1L; desenhar() }, lp(4))
    }

    /* ---------- painel (tudo pronto) ---------- */

    private fun painel() {
        val a = Armazem(this)
        val cfg = a.config()
        val heroi = cartao(Cores.VERDE_CLARO, Cores.VERDE)
        heroi.addView(ilustracao("🛡️", Cores.BRANCO))
        heroi.addView(texto("Vigia ligado", 26f, Cores.VERDE, negrito = true, centro = true))
        val nomes = cfg?.nomesAlerta().orEmpty()
        heroi.addView(texto(if (nomes.isEmpty()) "Ninguém marcado para receber os alarmes." else "Alarmes vão por SMS para: " + nomes.joinToString(", "),
            17f, Cores.TEXTO, centro = true), lp(6))
        caixa.addView(heroi, lp(12))

        val info = cartao()
        val ult = a.ultimaLeitura()
        info.addView(linhaInfo("🩸", "Última leitura vista", ult?.let { "${it.first.valor} mg/dL às ${hora(it.second)}" } ?: "nenhuma ainda"))
        info.addView(linhaInfo("🚨", "Último alarme repassado", a.ultimoRepasse.ifEmpty { "nenhum ainda" }))
        info.addView(linhaInfo("💚", "\"Tudo funcionando\"", if (cfg == null || cfg.vidaHoras == 0) "desligado" else "a cada ${cfg.vidaHoras} h"))
        caixa.addView(info, lp(12))

        if (a.aviso.isNotEmpty()) caixa.addView(cartao(Cores.AMBAR_CLARO, Cores.DOURADO).apply {
            addView(texto("ℹ️ " + a.aviso, 16f, Cores.AMBAR, negrito = true))
        }, lp(12))

        caixa.addView(botao("Enviar SMS de teste") { enviarTeste() }, lp(16))
        caixa.addView(botao("Atualizar configuração", principal = false) { emSegundoPlano { Servidor.atualizarConfig(this) ?: "Configuração atualizada." } }, lp(10))
        caixa.addView(botao("Voltar ao diário", principal = false) { finish() }, lp(10))

        caixa.addView(link(if (detalhes) "Esconder detalhes técnicos" else "Detalhes técnicos") { detalhes = !detalhes; desenhar() }, lp(14))
        if (detalhes) {
            val d = cartao()
            val diag = a.diagnostico()
            d.addView(texto("Avisos da Abbott vistos (só neste celular, apagam em 24 h)", 15f, Cores.AZUL_ESCURO, negrito = true), lp(baixo = 6))
            d.addView(texto(if (diag.isEmpty()) "Nenhum ainda." else diag.takeLast(20).reversed().joinToString("\n"), 13f, Cores.SUAVE))
            d.addView(texto("Verificação automática: " + (if (a.verificadorMs == 0L) "ainda não rodou" else "última às ${hora(a.verificadorMs)}"), 14f, Cores.SUAVE), lp(10))
            d.addView(texto("Assinatura do app: " + impressao(), 12f, Cores.SUAVE).apply { setTextIsSelectable(true) }, lp(10))
            d.addView(link("Desligar o vigia neste celular") { confirmarDesligar() }, lp(10))
            caixa.addView(d, lp(8))
        }
    }

    private fun linhaInfo(emoji: String, rotulo: String, valor: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(8), 0, dp(8))
        addView(texto(emoji, 24f).apply { minWidth = dp(44) })
        addView(coluna().apply {
            addView(texto(rotulo, 14f, Cores.SUAVE))
            addView(texto(valor, 18f, Cores.TEXTO, negrito = true))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
    }

    private fun confirmarDesligar() {
        AlertDialog.Builder(this)
            .setTitle("Desligar o vigia?")
            .setMessage("Os alarmes da Abbott deixam de ir por SMS para a família a partir deste celular.")
            .setPositiveButton("Desligar") { _, _ -> Armazem(this).vigiaAtivo = false; finish() }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    /* ---------- ações ---------- */

    private fun enviarTeste() {
        val cfg = Armazem(this).config() ?: return
        val tels = cfg.telefonesAlerta()
        if (tels.isEmpty()) { mensagem = "Ninguém marcado para receber alertas."; desenhar(); return }
        emSegundoPlano {
            tels.forEach { Sms.enviar(this, it, Mensagens.teste(), contarNoTeto = true) }
            Armazem(this).testouMs = System.currentTimeMillis()
            "📨 SMS de teste enviado para ${tels.size} pessoa(s). Confira se chegou."
        }
    }

    private fun abrirNotificacoes() {
        tentouNotif = true
        val componente = ComponentName(this, Ouvinte::class.java).flattenToString()
        val direto = if (Build.VERSION.SDK_INT >= 30)
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, componente)
        else null
        abrir(direto, Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    private fun abrirPaginaDoApp() {
        abrir(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")), Intent(Settings.ACTION_SETTINGS))
    }

    /** Abre a primeira tela de Configurações que existir neste celular (plano B se o atalho não abrir). */
    private fun abrir(vararg opcoes: Intent?) {
        for (i in opcoes) {
            if (i == null) continue
            try { startActivity(i); return } catch (e: Exception) { /* tenta a próxima */ }
        }
        mensagem = "Não consegui abrir as Configurações. Abra pelo app Configurações → Apps → Atlas Saúde."
        desenhar()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1) Armazem(this).negadoSms = grantResults.isEmpty() || grantResults[0] != PackageManager.PERMISSION_GRANTED
        desenhar()
    }

    private fun emSegundoPlano(trabalho: () -> String?) {
        mensagem = "Um instante…"; desenhar()
        Thread {
            val msg = try { trabalho() } catch (e: Exception) { "Erro: " + (e.message ?: "desconhecido") }
            principal.post { mensagem = msg; if (!isFinishing) { desenhar(); rolar.scrollTo(0, 0) } }
        }.start()
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
