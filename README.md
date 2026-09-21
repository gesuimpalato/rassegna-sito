# Rassegna — sito pubblico

Versione web di [Rassegna](https://github.com/gesuimpalato/rassegna), una
rassegna stampa che raccoglie le notizie globali da 34 testate ad accesso
libero e le organizza per geopolitica, economia e informatica.

**https://gesuimpalato.github.io/rassegna-sito/**

Si installa come app dal browser: su iPhone *Condividi → Aggiungi a schermata
Home*, su Android e desktop *Installa app*.

## Perché questo repository esiste

L'app per Mac, Windows e Android scarica i feed da sé, con la rete di sistema.
Un browser non può fare altrettanto: quasi nessuna testata espone le
intestazioni CORS necessarie, quindi Safari e Chrome rifiuterebbero le
richieste. Qui il feed viene perciò generato a monte, ogni mezz'ora da un
processo automatico, e pubblicato come file statico che l'app legge.

Di ogni articolo si conservano solo titolo, la sintesi che la testata pubblica
nel proprio feed e il collegamento all'originale: il testo integrale resta sul
sito dell'editore, che ne detiene i diritti.

Il codice dell'app impacchettata e la sua catena di compilazione stanno nel
repository principale; qui c'è solo ciò che serve a generare e servire il sito.
