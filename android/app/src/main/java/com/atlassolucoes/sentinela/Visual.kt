package com.atlassolucoes.sentinela

/* Peças de tela com a cara do Atlas Saúde (azul #17458F, dourado #F7A81B, fundo #F4F8FB).
   Sem bibliotecas novas: cartões e botões desenhados com GradientDrawable + RippleDrawable. */

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

object Cores {
    val AZUL = Color.rgb(0x17, 0x45, 0x8F)
    val AZUL_ESCURO = Color.rgb(0x0E, 0x2C, 0x5E)
    val AZUL_CLARO = Color.rgb(0xE4, 0xEE, 0xFA)
    val DOURADO = Color.rgb(0xF7, 0xA8, 0x1B)
    val FUNDO = Color.rgb(0xF4, 0xF8, 0xFB)
    val TEXTO = Color.rgb(0x12, 0x21, 0x2B)
    val SUAVE = Color.rgb(0x5B, 0x6B, 0x78)
    val VERDE = Color.rgb(0x1E, 0x7B, 0x4F)
    val VERDE_CLARO = Color.rgb(0xE3, 0xF4, 0xEA)
    val AMBAR = Color.rgb(0x8A, 0x52, 0x00)
    val AMBAR_CLARO = Color.rgb(0xFF, 0xF3, 0xD6)
    val LINHA = Color.rgb(0xD5, 0xE0, 0xE8)
    val BRANCO = Color.WHITE
}

fun Context.dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

fun Context.forma(cor: Int, raio: Int, borda: Int = 0, corBorda: Int = 0): GradientDrawable =
    GradientDrawable().apply {
        setColor(cor); cornerRadius = dp(raio).toFloat()
        if (borda > 0) setStroke(dp(borda), corBorda)
    }

fun Context.lp(topo: Int = 0, baixo: Int = 0, largura: Int = LinearLayout.LayoutParams.MATCH_PARENT): LinearLayout.LayoutParams =
    LinearLayout.LayoutParams(largura, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(topo); bottomMargin = dp(baixo) }

fun Context.texto(t: String, tam: Float = 17f, cor: Int = Cores.TEXTO, negrito: Boolean = false, centro: Boolean = false): TextView =
    TextView(this).apply {
        text = t; textSize = tam; setTextColor(cor); setLineSpacing(0f, 1.15f)
        if (negrito) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        if (centro) gravity = Gravity.CENTER_HORIZONTAL
    }

fun Context.coluna(): LinearLayout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

/** Cartão branco arredondado. */
fun Context.cartao(cor: Int = Cores.BRANCO, borda: Int = Cores.LINHA): LinearLayout = coluna().apply {
    background = forma(cor, 22, 1, borda)
    setPadding(dp(20), dp(18), dp(20), dp(20))
    elevation = dp(1).toFloat()
}

/** Botão grande. principal = azul cheio; senão contorno azul. */
fun Context.botao(t: String, principal: Boolean = true, acao: () -> Unit): TextView = TextView(this).apply {
    text = t; textSize = 18f; gravity = Gravity.CENTER
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    minHeight = dp(58); setPadding(dp(16), dp(12), dp(16), dp(12))
    val fundo = if (principal) forma(Cores.AZUL, 18) else forma(Cores.BRANCO, 18, 2, Cores.AZUL)
    setTextColor(if (principal) Cores.BRANCO else Cores.AZUL)
    background = RippleDrawable(ColorStateList.valueOf(if (principal) Color.argb(70, 255, 255, 255) else Color.argb(40, 23, 69, 143)), fundo, null)
    isClickable = true; isFocusable = true
    setOnClickListener { acao() }
}

/** Link discreto (texto azul sublinhado). */
fun Context.link(t: String, acao: () -> Unit): TextView = texto(t, 16f, Cores.AZUL, negrito = true, centro = true).apply {
    paintFlags = paintFlags or android.graphics.Paint.UNDERLINE_TEXT_FLAG
    setPadding(dp(8), dp(14), dp(8), dp(14)); isClickable = true; isFocusable = true
    setOnClickListener { acao() }
}

/** Círculo com emoji grande, a "ilustração" de cada passo. */
fun Context.ilustracao(emoji: String, fundo: Int = Cores.AZUL_CLARO): View = TextView(this).apply {
    text = emoji; textSize = 46f; gravity = Gravity.CENTER
    background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(fundo) }
    layoutParams = LinearLayout.LayoutParams(dp(112), dp(112)).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(8); bottomMargin = dp(12) }
}

/** Barra de progresso em 5 pedaços. */
fun Context.progresso(passo: Int, total: Int): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    for (i in 1..total) addView(View(context).apply {
        background = forma(if (i <= passo) Cores.DOURADO else Cores.LINHA, 4)
        layoutParams = LinearLayout.LayoutParams(0, dp(8), 1f).apply { if (i > 1) leftMargin = dp(6) }
    })
}

/** Linha "• texto" de uma lista numerada/explicativa. */
fun Context.item(marca: String, t: String): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(6), 0, dp(6))
    addView(texto(marca, 17f, Cores.AZUL, negrito = true).apply { minWidth = dp(30) })
    addView(texto(t, 17f).apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
}

/** Desenho do topo da página do app no Android, com a seta apontando para os ⋮. */
fun Context.desenhoTresPontos(): LinearLayout = coluna().apply {
    background = forma(Color.rgb(0x22, 0x26, 0x2E), 16)
    setPadding(dp(16), dp(14), dp(16), dp(14))
    addView(LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        addView(texto("←   Informações do app", 16f, Color.rgb(0xDD, 0xE3, 0xEA)).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            ellipsize = TextUtils.TruncateAt.END; maxLines = 1
        })
        addView(texto("⋮", 26f, Color.WHITE, negrito = true).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.TRANSPARENT); setStroke(dp(3), Cores.DOURADO) }
            layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
        })
    })
    addView(texto("toque aqui  ☝️", 15f, Cores.DOURADO, negrito = true).apply { gravity = Gravity.END })
}
