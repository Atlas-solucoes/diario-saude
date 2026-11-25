package com.atlassolucoes.sentinela

import com.atlassolucoes.sentinela.logica.*
import org.junit.Assert.*
import org.junit.Test

/* Telefones SÓ falsos. Textos de notificação de exemplo: os que o Daniel viu no LibreLinkUp (25/11). */
class LogicaTest {
    private val LIBRE = "com.freestylelibre.app.br"

    private val configJson = """
        {"familia":{"versao":3,"doc":{
          "acompanhada":{"apelido":"Estrela","emoji":"⭐"},
          "familia":[
            {"id":"pai","apelido":"Pai","emoji":"👨","telefone":"+5511900000000","anota":true},
            {"id":"mae","apelido":"Mãe","emoji":"👩","telefone":"+5511900000001","anota":true},
            {"id":"p-dinda","apelido":"Dinda","emoji":"👩","telefone":"+5511900000002","anota":false},
            {"id":"filha","apelido":"Filha","emoji":"👧","telefone":"","anota":true},
            {"id":"p-ruim","apelido":"X","telefone":"123","anota":false}],
          "mensagens":{"recebem":{"pai":{"alertas":true,"vida":true},"mae":{"alertas":true,"vida":false},
             "p-dinda":{"alertas":true,"vida":false},"p-ruim":{"alertas":true,"vida":true}},
             "vidaHoras":2,"conteudo":{"valor":true,"seta":true,"hora":true,"apelido":false}}}}}
    """.trimIndent()

    @Test fun reconheceAlarmesDaAbbott() {
        assertEquals(TipoAviso.ALARME_ALTA, Reconhecedor.reconhecer(LIBRE, "Helena", "Alarme de glicose alta: 222 mg/dL →", false).tipo)
        assertEquals(TipoAviso.ALARME_BAIXA, Reconhecedor.reconhecer(LIBRE, null, "Alarme de glicose baixa: 57 mg/dL ↓", false).tipo)
        assertEquals(TipoAviso.PERDA_SINAL, Reconhecedor.reconhecer(LIBRE, "Helena", "Nenhum dado recente. Você não está mais recebendo dados.", false).tipo)
        assertEquals(TipoAviso.PERDA_SINAL, Reconhecedor.reconhecer(LIBRE, "Alarme de perda de sinal", "", false).tipo)
        val r = Reconhecedor.reconhecer(LIBRE, "Helena", "Alarme de glicose alta: 222 mg/dL →", false)
        assertEquals(222, r.leitura.valor); assertEquals("estavel", r.leitura.seta); assertTrue(r.ehAlarme)
    }

    @Test fun leituraComumNaoEhAlarme() {
        val r = Reconhecedor.reconhecer(LIBRE, "Helena", "Leitura de glicose: 57 mg/dL ↓", true)
        assertEquals(TipoAviso.LEITURA, r.tipo); assertEquals(57, r.leitura.valor); assertEquals("descendo", r.leitura.seta); assertFalse(r.ehAlarme)
    }

    @Test fun outrosAppsEFixaSemNumeroSaoIgnorados_desconhecidaDaAbbottViraAviso() {
        assertEquals(TipoAviso.IGNORAR, Reconhecedor.reconhecer("com.whatsapp", "Alarme", "glicose alta 300 mg/dL", false).tipo)
        assertEquals(TipoAviso.IGNORAR, Reconhecedor.reconhecer(LIBRE, "FreeStyle LibreLink", "Em execução", true).tipo)
        assertEquals(TipoAviso.AVISO_ABBOTT, Reconhecedor.reconhecer(LIBRE, "Sensor", "Seu sensor termina em 1 dia", false).tipo)
        assertFalse("'falta' não é 'alta'", Reconhecedor.reconhecer(LIBRE, null, "Alarme: leitura em falta", false).tipo == TipoAviso.ALARME_ALTA)
    }

    @Test fun configLidaSoComTelefonesValidos() {
        val c = LeitorConfig.ler(configJson)!!
        assertEquals(3, c.versao); assertEquals(2, c.vidaHoras)
        assertEquals(listOf("+5511900000000", "+5511900000001", "+5511900000002"), c.telefonesAlerta())
        assertEquals(listOf("+5511900000000"), c.telefonesVida())
        assertNull(LeitorConfig.ler("{\"familia\":null}"))
        assertNull(LeitorConfig.ler("lixo"))
    }

    @Test fun mensagemDeAlarme_semTextoDaAbbott_semNome_ascii_umSms() {
        val c = LeitorConfig.ler(configJson)!!
        val r = Reconhecedor.reconhecer(LIBRE, "Helena Gomes De Carvalho", "Alarme de glicose alta: 222 mg/dL →", false)
        val m = Mensagens.alarme(c, r, "03:20")
        assertEquals("Atlas Saude: ALARME glicose alta (app Abbott). 222 mg/dL estavel as 03:20", m)
        assertFalse(m.contains("Helena")); assertTrue(m.length <= 160); assertTrue(m.all { it.code in 0x20..0x7E })
        val comApelido = c.copy(conteudo = c.conteudo.copy(apelido = true, seta = false))
        assertEquals("Atlas Saude: Estrela - ALARME glicose alta (app Abbott). 222 mg/dL as 03:20", Mensagens.alarme(comApelido, r, "03:20"))
    }

    @Test fun mensagemDeVida() {
        val c = LeitorConfig.ler(configJson)!!
        assertEquals("Atlas Saude: Sentinela funcionando (14:30). Ultima leitura: 120 mg/dL estavel as 14:25.",
            Mensagens.vida(c, "14:30", Leitura(120, "estavel"), "14:25", 5))
        assertEquals("Atlas Saude: Sentinela funcionando (14:30). Sem leitura recente do sensor.", Mensagens.vida(c, "14:30", Leitura(120, "estavel"), "13:00", 90))
        assertEquals("Atlas Saude: Sentinela funcionando (14:30). Sem leitura recente do sensor.", Mensagens.vida(c, "14:30", null, null, null))
    }

    @Test fun freios() {
        val dia = "2026-11-25"; var e = EstadoFreios(); val t0 = 1_000_000_000L
        var r = Freios.alarme(e, TipoAviso.ALARME_ALTA, t0, dia, 3); assertEquals(Decisao.ENVIAR, r.first); e = r.second
        r = Freios.alarme(e, TipoAviso.ALARME_ALTA, t0 + 5 * 60_000, dia, 3); assertEquals("mesmo tipo em 10 min", Decisao.REPETIDO, r.first)
        r = Freios.alarme(e, TipoAviso.ALARME_BAIXA, t0 + 5 * 60_000, dia, 3); assertEquals("outro tipo passa", Decisao.ENVIAR, r.first); e = r.second
        val tipos = listOf(TipoAviso.PERDA_SINAL, TipoAviso.ALARME, TipoAviso.AVISO_ABBOTT, TipoAviso.ALARME_ALTA)
        tipos.forEachIndexed { i, t -> r = Freios.alarme(e, t, t0 + (11 + i) * 60_000L, dia, 3); e = r.second }
        r = Freios.alarme(e, TipoAviso.ALARME_BAIXA, t0 + 20 * 60_000, dia, 3); assertEquals("7º evento na hora", Decisao.LIMITE_HORA, r.first)
        var cheio = EstadoFreios(dia = dia, smsHoje = Freios.SMS_POR_DIA - 1)
        r = Freios.alarme(cheio, TipoAviso.ALARME_ALTA, t0, dia, 3); assertEquals(Decisao.AVISAR_TETO, r.first); cheio = r.second
        r = Freios.alarme(cheio, TipoAviso.ALARME_ALTA, t0 + 3 * 60 * 60_000L, dia, 3); assertEquals(Decisao.LIMITE_DIA, r.first)
        r = Freios.alarme(cheio, TipoAviso.ALARME_ALTA, t0 + 3 * 60 * 60_000L, "2026-11-26", 3); assertEquals("dia novo zera o teto", Decisao.ENVIAR, r.first)
        assertEquals(e, Freios.deJson(Freios.paraJson(e)))
    }

    @Test fun listaDeQuemRecebeMudou() {
        val c = LeitorConfig.ler(configJson)!!
        assertFalse(LeitorConfig.mudouQuemRecebe(null, c))
        assertFalse(LeitorConfig.mudouQuemRecebe(c, c.copy(versao = 4)))
        assertTrue(LeitorConfig.mudouQuemRecebe(c, c.copy(alertas = setOf("pai"))))
    }

    @Test fun vidaNaHora() {
        assertFalse(Vida.estaNaHora(0, 0, 10 * Freios.HORA_MS))
        assertTrue(Vida.estaNaHora(2, 0, 2 * Freios.HORA_MS))
        assertFalse(Vida.estaNaHora(2, 0, Freios.HORA_MS))
    }
}
