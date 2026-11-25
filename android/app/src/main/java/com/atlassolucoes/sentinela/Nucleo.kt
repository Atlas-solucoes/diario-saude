package com.atlassolucoes.sentinela

/*
 * Parte Android do Sentinela: guardar estado, falar com o servidor da família, enviar SMS e decidir o que repassar.
 * A decisão (o que é alarme, o que vai no SMS, freios) está em logica/Logica.kt, testada no GitHub Actions.
 */

import android.app.Application
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.atlassolucoes.sentinela.logica.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

const val API = "https://atlas-saude-api.derim23.workers.dev"

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // A cada 15 min (mínimo do Android): baixa a configuração, reenvia o que ficou na fila e manda o "tudo funcionando".
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "verificador", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<Verificador>(15, TimeUnit.MINUTES).build()
        )
    }
}

/** Estado do Sentinela, só neste aparelho. */
class Armazem(ctx: Context) {
    private val p = ctx.getSharedPreferences("sentinela", Context.MODE_PRIVATE)

    var token: String? get() = p.getString("token", null); set(v) { p.edit().putString("token", v).apply() }
    var configJson: String? get() = p.getString("config", null); set(v) { p.edit().putString("config", v).apply() }
    var desconectado: Boolean get() = p.getBoolean("desconectado", false); set(v) { p.edit().putBoolean("desconectado", v).apply() }
    var freios: EstadoFreios get() = Freios.deJson(p.getString("freios", null)); set(v) { p.edit().putString("freios", Freios.paraJson(v)).apply() }
    var ultimaVidaMs: Long get() = p.getLong("ultimaVida", 0L); set(v) { p.edit().putLong("ultimaVida", v).apply() }
    var ouvinteMs: Long get() = p.getLong("ouvinte", 0L); set(v) { p.edit().putLong("ouvinte", v).apply() }
    var verificadorMs: Long get() = p.getLong("verificador", 0L); set(v) { p.edit().putLong("verificador", v).apply() }
    var ultimoRepasse: String get() = p.getString("ultimoRepasse", "") ?: ""; set(v) { p.edit().putString("ultimoRepasse", v).apply() }
    var aviso: String get() = p.getString("aviso", "") ?: ""; set(v) { p.edit().putString("aviso", v).apply() }

    /** Vigia ligado NESTE celular? Sem isso nada é repassado (o app do pai/mãe/irmão/Dinda nunca manda SMS).
     *  Quem veio da v7 já configurada (tinha token) continua ligado. */
    var vigiaAtivo: Boolean
        get() = PonteRegras.vigiaAtivo(if (p.contains("vigiaAtivo")) p.getBoolean("vigiaAtivo", false) else null, p.getString("token", null) != null)
        set(v) { p.edit().putBoolean("vigiaAtivo", v).apply() }
    /** Assistente do vigia: já passou das boas-vindas? já mandou o SMS de teste? */
    var comecou: Boolean get() = p.getBoolean("comecou", false); set(v) { p.edit().putBoolean("comecou", v).apply() }
    var testouMs: Long get() = p.getLong("testou", 0L); set(v) { p.edit().putLong("testou", v).apply() }
    /** O Android negou (configuração restrita)? Aí o assistente mostra o "destravar". */
    var negadoNotif: Boolean get() = p.getBoolean("negadoNotif", false); set(v) { p.edit().putBoolean("negadoNotif", v).apply() }
    var negadoSms: Boolean get() = p.getBoolean("negadoSms", false); set(v) { p.edit().putBoolean("negadoSms", v).apply() }
    var pediuSms: Boolean get() = p.getBoolean("pediuSms", false); set(v) { p.edit().putBoolean("pediuSms", v).apply() }

    fun config(): Config? = configJson?.let { LeitorConfig.ler(it) }

    fun guardarLeitura(l: Leitura, ms: Long) {
        if (l.valor == null) return
        p.edit().putInt("leituraValor", l.valor).putString("leituraSeta", l.seta).putLong("leituraMs", ms).apply()
    }
    fun ultimaLeitura(): Pair<Leitura, Long>? {
        val ms = p.getLong("leituraMs", 0L)
        if (ms == 0L) return null
        return Leitura(p.getInt("leituraValor", 0), p.getString("leituraSeta", null)) to ms
    }

    /** Fila de SMS que não saíram (sem sinal): reenviados pelo Verificador. Vencem em 2 h (aviso velho não serve mais). */
    data class NaFila(val tel: String, val msg: String, val ms: Long)
    fun fila(): MutableList<NaFila> {
        val a = try { JSONArray(p.getString("fila", "[]")) } catch (e: Exception) { JSONArray() }
        val limite = System.currentTimeMillis() - 2 * 3600_000L
        return (0 until a.length()).map { a.getJSONObject(it).let { o -> NaFila(o.getString("tel"), o.getString("msg"), o.optLong("ms", 0L)) } }
            .filter { it.ms > limite }.toMutableList()
    }
    fun guardarFila(l: List<NaFila>) {
        val a = JSONArray(); l.takeLast(50).forEach { a.put(JSONObject().put("tel", it.tel).put("msg", it.msg).put("ms", it.ms)) }
        p.edit().putString("fila", a.toString()).apply()
    }
    @Synchronized fun naFila(tel: String, msg: String, ms: Long = System.currentTimeMillis()) { val f = fila(); f.add(NaFila(tel, msg, ms)); guardarFila(f) }

    /** Diagnóstico: as últimas 20 notificações da Abbott vistas, só neste aparelho, apagadas depois de 24 h. */
    fun diagnostico(): List<String> {
        val a = try { JSONArray(p.getString("diag", "[]")) } catch (e: Exception) { JSONArray() }
        val limite = System.currentTimeMillis() - 24 * 3600_000L
        return (0 until a.length()).map { a.getJSONObject(it) }.filter { it.getLong("ms") > limite }
            .map { hora(it.getLong("ms")) + " [" + it.getString("tipo") + "] " + it.getString("texto") }
    }
    @Synchronized fun anotarDiagnostico(texto: String, tipo: String) {
        val a = try { JSONArray(p.getString("diag", "[]")) } catch (e: Exception) { JSONArray() }
        val limite = System.currentTimeMillis() - 24 * 3600_000L
        val novo = JSONArray()
        (0 until a.length()).map { a.getJSONObject(it) }.filter { it.getLong("ms") > limite }.takeLast(19).forEach { novo.put(it) }
        novo.put(JSONObject().put("ms", System.currentTimeMillis()).put("tipo", tipo).put("texto", texto.take(120)))
        p.edit().putString("diag", novo.toString()).apply()
    }
}

/** O usuário deu (e não tirou) o acesso às notificações? */
fun temAcessoNotificacoes(ctx: Context): Boolean =
    androidx.core.app.NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

fun hora(ms: Long): String = SimpleDateFormat("HH:mm", Locale("pt", "BR")).format(Date(ms))
fun dia(ms: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(ms))

/** Servidor da família (o mesmo do Atlas Saúde). Só HTTPS; o token vai no cabeçalho. */
object Servidor {
    private fun post(caminho: String, corpo: JSONObject, token: String?): Pair<Int, String> {
        val c = URL(API + caminho).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = 15000; c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
            c.outputStream.use { it.write(corpo.toString().toByteArray()) }
            val cod = c.responseCode
            val txt = (if (cod in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            return cod to txt
        } finally { c.disconnect() }
    }

    /** Entra na família com o convite (gerado no Atlas Saúde pelo responsável). Devolve mensagem para a tela. */
    fun entrar(ctx: Context, codigo: String): String {
        val (cod, txt) = post("/api/entrar", JSONObject().put("codigo", codigo).put("nome", "Sentinela"), null)
        if (cod != 200) return try { JSONObject(txt).optString("erro", "Não deu para entrar ($cod).") } catch (e: Exception) { "Não deu para entrar ($cod)." }
        val a = Armazem(ctx)
        a.token = JSONObject(txt).getString("token"); a.desconectado = false
        return atualizarConfig(ctx) ?: "Conectado à família."
    }

    /** Baixa a configuração. Sem internet, fica a última guardada. Devolve erro (ou null se deu certo). */
    fun atualizarConfig(ctx: Context): String? {
        val a = Armazem(ctx)
        val t = a.token ?: return "Ainda não entrou na família."
        return try {
            val (cod, txt) = post("/api/config", JSONObject(), t)
            if (cod == 401) { a.desconectado = true; return "Este celular foi desconectado da família. Continua repassando com a última configuração." }
            if (cod != 200) return "Servidor respondeu $cod."
            val nova = LeitorConfig.ler(txt) ?: return "A família ainda não salvou a configuração das mensagens."
            val antiga = a.config()
            a.configJson = txt
            if (LeitorConfig.mudouQuemRecebe(antiga, nova)) {
                // ninguém sai da lista em silêncio: avisa quem recebia e quem passa a receber
                (antiga!!.telefonesAlerta() + nova.telefonesAlerta()).distinct().forEach { Sms.enviar(ctx, it, Mensagens.listaMudou(), contarNoTeto = true) }
            }
            null
        } catch (e: Exception) { "Sem internet agora: usando a última configuração." }
    }
}

object Sms {
    /** Envia 1 SMS pelo chip padrão. Se não sair (sem sinal), vai para a fila. */
    fun enviar(ctx: Context, tel: String, msg: String, contarNoTeto: Boolean, desdeMs: Long = System.currentTimeMillis()) {
        val a = Armazem(ctx)
        if (!a.vigiaAtivo) return // trava única: celular sem vigia ligado nunca manda SMS
        if (contarNoTeto) {
            val (pode, e) = Freios.contar(a.freios, dia(System.currentTimeMillis()), 1)
            a.freios = e
            if (!pode) return
        }
        try {
            val sm: SmsManager = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
            val i = Intent(ctx, ResultadoSms::class.java).putExtra("tel", tel).putExtra("msg", msg).putExtra("ms", desdeMs)
            val pi = PendingIntent.getBroadcast(ctx, (tel + msg + System.nanoTime()).hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            sm.sendTextMessage(tel, null, msg, pi, null)
        } catch (e: Exception) {
            a.naFila(tel, msg, desdeMs)
            a.aviso = "SMS não saiu agora (" + (e.message ?: "erro") + "). Vai tentar de novo."
        }
    }
}

/** Resultado do envio: se a operadora não aceitou (sem sinal etc.), o SMS volta para a fila. */
class ResultadoSms : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (resultCode != android.app.Activity.RESULT_OK) {
            val tel = intent.getStringExtra("tel") ?: return
            val msg = intent.getStringExtra("msg") ?: return
            Armazem(ctx).naFila(tel, msg, intent.getLongExtra("ms", System.currentTimeMillis()))
        }
    }
}

/** O que fazer com um aviso reconhecido. Chamado pelo Ouvinte. */
object Central {
    fun repassar(ctx: Context, r: Reconhecido, agora: Long) {
        val a = Armazem(ctx)
        if (!a.vigiaAtivo) return
        val cfg = a.config()
        if (cfg == null) { a.aviso = "Alarme visto, mas a configuração da família ainda não foi baixada: nada foi enviado."; return }
        val tels = cfg.telefonesAlerta()
        if (tels.isEmpty()) { a.aviso = "Alarme visto, mas ninguém está marcado para receber alertas."; return }
        val (dec, e) = Freios.alarme(a.freios, r.tipo, agora, dia(agora), tels.size)
        a.freios = e
        when (dec) {
            Decisao.ENVIAR -> {
                val msg = Mensagens.alarme(cfg, r, hora(agora))
                tels.forEach { Sms.enviar(ctx, it, msg, contarNoTeto = false) }
                a.ultimoRepasse = hora(agora) + " " + Mensagens.rotulo(r.tipo) + " → " + tels.size + " pessoa(s)"
            }
            Decisao.AVISAR_TETO -> tels.forEach { Sms.enviar(ctx, it, Mensagens.teto(), contarNoTeto = false) }
            Decisao.REPETIDO -> {}
            Decisao.LIMITE_HORA -> a.aviso = "Muitos alarmes nesta hora: o Sentinela segurou para não mandar SMS demais."
            Decisao.LIMITE_DIA -> a.aviso = "Limite de SMS do dia atingido."
        }
    }
}

/** A cada 15 min: configuração, fila e "está tudo funcionando". */
class Verificador(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val a = Armazem(ctx)
        if (!a.vigiaAtivo) return Result.success()
        val agora = System.currentTimeMillis()
        a.verificadorMs = agora
        if (a.token != null) Servidor.atualizarConfig(ctx)
        // reenvia a fila (o que não saiu por falta de sinal)
        val fila = a.fila(); a.guardarFila(emptyList())
        fila.forEach { Sms.enviar(ctx, it.tel, it.msg, contarNoTeto = false, desdeMs = it.ms) }
        val cfg = a.config() ?: return Result.success()
        if (Vida.estaNaHora(cfg.vidaHoras, a.ultimaVidaMs, agora)) {
            val ult = a.ultimaLeitura()
            var msg = Mensagens.vida(cfg, hora(agora), ult?.first, ult?.let { hora(it.second) }, ult?.let { (agora - it.second) / 60000 })
            if (!temAcessoNotificacoes(ctx)) msg = Texto.corta(msg + " Atencao: acesso as notificacoes desligado.")
            cfg.telefonesVida().forEach { Sms.enviar(ctx, it, msg, contarNoTeto = true) }
            a.ultimaVidaMs = agora
        }
        return Result.success()
    }
}
