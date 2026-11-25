package com.atlassolucoes.sentinela.logica

/*
 * Lógica pura do Sentinela (sem Android), testada no GitHub Actions com JUnit.
 * Regras (ANALISE-SENTINELA.md + parecer do Engenheiro de 25/11, 4h):
 *  - Decisão A do Daniel: os limites ficam no app da Abbott. Aqui só se REPASSA o tipo de alarme que a Abbott já deu.
 *  - Nunca repassar o texto bruto da Abbott: o SMS leva só um tipo de uma lista fixa + valor + seta + hora (+ apelido, se marcado).
 *  - SMS sempre em ASCII (sem acento/seta) e no máximo 160 caracteres, para ser 1 SMS só.
 *  - Notificação da Abbott não reconhecida vira "aviso" repassado, nunca silêncio (exceto a notificação fixa sem número).
 */

import org.json.JSONObject
import java.text.Normalizer

enum class TipoAviso { ALARME_ALTA, ALARME_BAIXA, ALARME, PERDA_SINAL, AVISO_ABBOTT, LEITURA, IGNORAR }

data class Leitura(val valor: Int?, val seta: String?)
data class Reconhecido(val tipo: TipoAviso, val leitura: Leitura) {
    val ehAlarme: Boolean get() = tipo in setOf(TipoAviso.ALARME_ALTA, TipoAviso.ALARME_BAIXA, TipoAviso.ALARME, TipoAviso.PERDA_SINAL, TipoAviso.AVISO_ABBOTT)
}

object Texto {
    fun semAcento(t: String): String = Normalizer.normalize(t, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
    /** Só caracteres ASCII imprimíveis: garante 1 SMS de até 160 caracteres (acento ou seta derrubam para 70). */
    fun ascii(t: String): String = semAcento(t).replace(Regex("[^\\x20-\\x7E]"), "").replace(Regex(" {2,}"), " ").trim()
    fun corta(t: String, max: Int = 160): String = if (t.length <= max) t else t.substring(0, max)
}

object Reconhecedor {
    private val VALOR = Regex("(\\d{2,3})\\s*mg\\s*/?\\s*dl", RegexOption.IGNORE_CASE)

    fun ehAbbott(pacote: String): Boolean {
        val p = pacote.lowercase()
        return "freestylelibre" in p || "librelink" in p || "abbott" in p
    }

    fun seta(texto: String): String? = when {
        texto.contains("⇈") || texto.contains("↑↑") -> "subindo rapido"
        texto.contains("↑") -> "subindo"
        texto.contains("↗") -> "subindo devagar"
        texto.contains("→") -> "estavel"
        texto.contains("↘") -> "descendo devagar"
        texto.contains("⇊") || texto.contains("↓↓") -> "descendo rapido"
        texto.contains("↓") -> "descendo"
        else -> null
    }

    private fun tem(t: String, palavra: String) = Regex("\\b$palavra\\b").containsMatchIn(t)

    fun reconhecer(pacote: String, titulo: String?, texto: String?, fixa: Boolean): Reconhecido {
        val vazio = Leitura(null, null)
        if (!ehAbbott(pacote)) return Reconhecido(TipoAviso.IGNORAR, vazio)
        val bruto = listOfNotNull(titulo, texto).joinToString(" ")
        val t = Texto.semAcento(bruto).lowercase()
        if (t.isBlank()) return Reconhecido(TipoAviso.IGNORAR, vazio)
        val valor = VALOR.find(bruto)?.groupValues?.get(1)?.toIntOrNull()
        val leitura = Leitura(valor, seta(bruto))
        val alarme = tem(t, "alarme") || tem(t, "alarm") || tem(t, "alerta")
        val tipo = when {
            "perda de sinal" in t || "signal loss" in t || "nenhum dado recente" in t || "sem sinal" in t -> TipoAviso.PERDA_SINAL
            alarme && (tem(t, "alta") || tem(t, "high")) -> TipoAviso.ALARME_ALTA
            alarme && (tem(t, "baixa") || tem(t, "low")) -> TipoAviso.ALARME_BAIXA
            alarme -> TipoAviso.ALARME
            valor != null -> TipoAviso.LEITURA
            fixa -> TipoAviso.IGNORAR // notificação fixa sem número ("app em execução"): não é aviso
            else -> TipoAviso.AVISO_ABBOTT
        }
        return Reconhecido(tipo, leitura)
    }
}

data class Pessoa(val id: String, val apelido: String, val telefone: String)
data class Conteudo(val valor: Boolean, val seta: Boolean, val hora: Boolean, val apelido: Boolean)
data class Config(
    val versao: Int, val apelido: String, val pessoas: List<Pessoa>,
    val alertas: Set<String>, val vida: Set<String>, val vidaHoras: Int, val conteudo: Conteudo
) {
    fun telefonesAlerta(): List<String> = pessoas.filter { it.id in alertas && it.telefone.isNotEmpty() }.map { it.telefone }.distinct()
    fun telefonesVida(): List<String> = pessoas.filter { it.id in vida && it.telefone.isNotEmpty() }.map { it.telefone }.distinct()
    fun nomesAlerta(): List<String> = pessoas.filter { it.id in alertas && it.telefone.isNotEmpty() }.map { it.apelido }
}

/** Lê a resposta de /api/config (o documento da família do Atlas Saúde). Telefone só no formato +55DD9XXXXXXXX. */
object LeitorConfig {
    private val TEL = Regex("^\\+55\\d{2}9\\d{8}$")
    private val HORAS = setOf(0, 1, 2, 4, 8)

    fun ler(resposta: String): Config? {
        val raiz = try { JSONObject(resposta) } catch (e: Exception) { return null }
        val fam = raiz.optJSONObject("familia") ?: return null
        val doc = fam.optJSONObject("doc") ?: return null
        val versao = fam.optInt("versao", 0)
        val pessoas = mutableListOf<Pessoa>()
        val lista = doc.optJSONArray("familia")
        if (lista != null) for (i in 0 until lista.length()) {
            val p = lista.optJSONObject(i) ?: continue
            val id = p.optString("id", "")
            if (id.isEmpty()) continue
            val tel = p.optString("telefone", "")
            pessoas.add(Pessoa(id, p.optString("apelido", id), if (TEL.matches(tel)) tel else ""))
        }
        val m = doc.optJSONObject("mensagens") ?: JSONObject()
        val rec = m.optJSONObject("recebem") ?: JSONObject()
        val alertas = mutableSetOf<String>()
        val vida = mutableSetOf<String>()
        for (id in rec.keys()) {
            val r = rec.optJSONObject(id) ?: continue
            if (r.optBoolean("alertas", false)) alertas.add(id)
            if (r.optBoolean("vida", false)) vida.add(id)
        }
        val h = m.optInt("vidaHoras", 0)
        val c = m.optJSONObject("conteudo") ?: JSONObject()
        val conteudo = Conteudo(c.optBoolean("valor", true), c.optBoolean("seta", true), c.optBoolean("hora", true), c.optBoolean("apelido", false))
        val apelido = doc.optJSONObject("acompanhada")?.optString("apelido", "") ?: ""
        return Config(versao, apelido, pessoas, alertas, vida, if (h in HORAS) h else 0, conteudo)
    }

    /** A lista de quem recebe os alertas mudou? (avisa a família, para ninguém ser tirado em silêncio) */
    fun mudouQuemRecebe(antes: Config?, depois: Config): Boolean =
        antes != null && antes.telefonesAlerta().toSet() != depois.telefonesAlerta().toSet()
}

object Mensagens {
    fun rotulo(tipo: TipoAviso): String = when (tipo) {
        TipoAviso.ALARME_ALTA -> "ALARME glicose alta (app Abbott)"
        TipoAviso.ALARME_BAIXA -> "ALARME glicose baixa (app Abbott)"
        TipoAviso.ALARME -> "ALARME do app Abbott"
        TipoAviso.PERDA_SINAL -> "ALERTA sem dados do sensor (app Abbott)"
        TipoAviso.AVISO_ABBOTT -> "Aviso do app Abbott, abra o app"
        else -> ""
    }

    private fun partesLeitura(c: Conteudo, l: Leitura?, hora: String?): List<String> {
        val p = mutableListOf<String>()
        if (l != null && l.valor != null && c.valor) p.add("${l.valor} mg/dL")
        if (l != null && l.seta != null && c.seta) p.add(l.seta)
        if (hora != null && c.hora) p.add("as $hora")
        return p
    }

    fun alarme(cfg: Config, r: Reconhecido, hora: String): String {
        val partes = mutableListOf("Atlas Saude:")
        if (cfg.conteudo.apelido && cfg.apelido.isNotBlank()) partes.add(cfg.apelido + " -")
        partes.add(rotulo(r.tipo) + ".")
        partes.addAll(partesLeitura(cfg.conteudo, r.leitura, hora))
        return Texto.corta(Texto.ascii(partes.joinToString(" ")))
    }

    /** "Está tudo funcionando". Leitura com mais de 30 min (ou nenhuma) é dita como "sem leitura recente". */
    fun vida(cfg: Config, agoraHora: String, ultima: Leitura?, horaUltima: String?, minutosDesde: Long?): String {
        val partes = mutableListOf("Atlas Saude:")
        if (cfg.conteudo.apelido && cfg.apelido.isNotBlank()) partes.add(cfg.apelido + " -")
        partes.add("Sentinela funcionando ($agoraHora).")
        if (ultima == null || minutosDesde == null || minutosDesde > 30) partes.add("Sem leitura recente do sensor.")
        else {
            val l = partesLeitura(cfg.conteudo, ultima, horaUltima)
            if (l.isNotEmpty()) partes.add("Ultima leitura: " + l.joinToString(" ") + ".")
        }
        return Texto.corta(Texto.ascii(partes.joinToString(" ")))
    }

    fun listaMudou(): String = "Atlas Saude: a lista de quem recebe os alertas mudou. Confira no app Atlas Saude."
    fun teto(): String = "Atlas Saude: limite diario de SMS do Sentinela atingido. Os alarmes continuam no app Abbott. Abra o app."
    fun teste(): String = "Atlas Saude: teste do Sentinela. Se voce recebeu, esta tudo certo."
}

/** Freios contra SMS demais: mesmo tipo não repete em 10 min; até 6 eventos de alarme por hora; teto de SMS por dia. */
data class EstadoFreios(val eventos: List<Long> = emptyList(), val ultimoPorTipo: Map<String, Long> = emptyMap(),
                        val dia: String = "", val smsHoje: Int = 0, val tetoAvisado: Boolean = false)

enum class Decisao { ENVIAR, REPETIDO, LIMITE_HORA, LIMITE_DIA, AVISAR_TETO }

object Freios {
    const val REPETE_MS = 10 * 60 * 1000L
    const val HORA_MS = 60 * 60 * 1000L
    const val EVENTOS_POR_HORA = 6
    const val SMS_POR_DIA = 120

    /** Decide um evento de alarme que mandaria `nSms` mensagens. Devolve a decisão e o estado novo. */
    fun alarme(e0: EstadoFreios, tipo: TipoAviso, agora: Long, dia: String, nSms: Int): Pair<Decisao, EstadoFreios> {
        val e = if (e0.dia != dia) EstadoFreios(eventos = e0.eventos, ultimoPorTipo = e0.ultimoPorTipo, dia = dia) else e0
        val ult = e.ultimoPorTipo[tipo.name]
        if (ult != null && agora - ult < REPETE_MS) return Decisao.REPETIDO to e
        val recentes = e.eventos.filter { agora - it < HORA_MS }
        if (recentes.size >= EVENTOS_POR_HORA) return Decisao.LIMITE_HORA to e.copy(eventos = recentes)
        if (e.smsHoje + nSms > SMS_POR_DIA) {
            return if (!e.tetoAvisado) Decisao.AVISAR_TETO to e.copy(eventos = recentes, tetoAvisado = true)
            else Decisao.LIMITE_DIA to e.copy(eventos = recentes)
        }
        return Decisao.ENVIAR to e.copy(eventos = recentes + agora, ultimoPorTipo = e.ultimoPorTipo + (tipo.name to agora), smsHoje = e.smsHoje + nSms)
    }

    /** Mensagens que não são alarme (vida, teste, lista mudou) só contam no teto do dia. */
    fun contar(e0: EstadoFreios, dia: String, nSms: Int): Pair<Boolean, EstadoFreios> {
        val e = if (e0.dia != dia) EstadoFreios(eventos = e0.eventos, ultimoPorTipo = e0.ultimoPorTipo, dia = dia) else e0
        if (e.smsHoje + nSms > SMS_POR_DIA) return false to e
        return true to e.copy(smsHoje = e.smsHoje + nSms)
    }

    fun paraJson(e: EstadoFreios): String {
        val o = JSONObject()
        o.put("eventos", org.json.JSONArray(e.eventos))
        val u = JSONObject(); e.ultimoPorTipo.forEach { (k, v) -> u.put(k, v) }
        o.put("ultimoPorTipo", u); o.put("dia", e.dia); o.put("smsHoje", e.smsHoje); o.put("tetoAvisado", e.tetoAvisado)
        return o.toString()
    }

    fun deJson(s: String?): EstadoFreios {
        if (s.isNullOrBlank()) return EstadoFreios()
        return try {
            val o = JSONObject(s)
            val ev = o.optJSONArray("eventos")
            val eventos = if (ev == null) emptyList() else (0 until ev.length()).map { ev.getLong(it) }
            val u = o.optJSONObject("ultimoPorTipo")
            val ult = mutableMapOf<String, Long>()
            if (u != null) for (k in u.keys()) ult[k] = u.getLong(k)
            EstadoFreios(eventos, ult, o.optString("dia", ""), o.optInt("smsHoje", 0), o.optBoolean("tetoAvisado", false))
        } catch (e: Exception) { EstadoFreios() }
    }
}

/** Hora de mandar o "está tudo funcionando"? (vidaHoras 0 = desligado) */
object Vida {
    fun estaNaHora(vidaHoras: Int, ultimaMs: Long, agoraMs: Long): Boolean =
        vidaHoras > 0 && agoraMs - ultimaMs >= vidaHoras * Freios.HORA_MS - 5 * 60 * 1000L
}
