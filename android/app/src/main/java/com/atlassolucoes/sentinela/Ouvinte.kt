package com.atlassolucoes.sentinela

import android.app.Notification
import android.content.ComponentName
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.atlassolucoes.sentinela.logica.Reconhecedor
import com.atlassolucoes.sentinela.logica.TipoAviso

/**
 * Ouve as notificações do app da Abbott. SÓ LÊ: nunca dispensa, adia nem silencia nada (os alarmes oficiais continuam iguais).
 * O trabalho pesado (SMS) roda fora da thread do sistema.
 */
class Ouvinte : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        Armazem(this).ouvinteMs = System.currentTimeMillis()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        // pede ao Android para religar a escuta (ex.: depois de atualizar o app)
        if (Build.VERSION.SDK_INT >= 24) NotificationListenerService.requestRebind(ComponentName(this, Ouvinte::class.java))
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pacote = sbn.packageName ?: return
        if (!Reconhecedor.ehAbbott(pacote)) return
        if (!Armazem(applicationContext).vigiaAtivo) return
        val ex = sbn.notification?.extras ?: return
        val titulo = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val texto = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString()
        val fixa = sbn.isOngoing
        val agora = System.currentTimeMillis()
        val ctx = applicationContext
        Thread {
            val r = Reconhecedor.reconhecer(pacote, titulo, texto, fixa)
            val a = Armazem(ctx)
            // diagnóstico (só neste aparelho, 24 h): ajuda a ajustar o reconhecimento ao texto real do app brasileiro
            a.anotarDiagnostico(pacote.substringAfterLast('.') + ": " + listOfNotNull(titulo, texto).joinToString(" | "), r.tipo.name)
            if (r.leitura.valor != null) a.guardarLeitura(r.leitura, agora)
            if (r.ehAlarme) Central.repassar(ctx, r, agora)
            else if (r.tipo == TipoAviso.LEITURA) a.ouvinteMs = agora
        }.start()
    }
}
