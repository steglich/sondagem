import { DestroyRef, Injectable, type Signal, inject, signal } from '@angular/core';
import { criarLimitador } from '../../../../shared/limitador';
import {
  type ComandoInterface,
  INTERVALO_LOTE_MS,
  type PedidoCenario,
  type RespostaComando,
  type Selecao,
  type VisaoSessao,
} from '../../../../shared/types';
import { PonteExtensao } from './ponte';

const VISAO_OCIOSA: VisaoSessao = {
  fase: 'ociosa',
  alvo: null,
  selecao: [],
  inicio: null,
  status: null,
  execucao: null,
  resultado: null,
};

/**
 * Estado da sessão visto pela interface. Mudanças de fase aparecem na hora;
 * atualizações de status dentro da mesma fase aparecem no máximo uma vez por segundo.
 */
@Injectable({ providedIn: 'root' })
export class ServicoSessao {
  private readonly ponte = inject(PonteExtensao);
  private readonly estado = signal<VisaoSessao>(VISAO_OCIOSA);
  private pendente: VisaoSessao = VISAO_OCIOSA;
  private readonly limitador = criarLimitador(INTERVALO_LOTE_MS, () => this.estado.set(this.pendente));

  readonly visao: Signal<VisaoSessao> = this.estado.asReadonly();

  constructor() {
    const cancelar = this.ponte.aoReceberVisao((visao) => this.receber(visao));
    inject(DestroyRef).onDestroy(() => {
      cancelar();
      this.limitador.cancelar();
    });
    // Reabrir o painel só consulta o estado: nunca inicia nada.
    void this.comando({ tipo: 'obter-visao' }).catch(() => undefined);
  }

  /** Com `cenario`, executa o cenário; sem ele, inicia uma sessão manual. */
  iniciar(idAba: number, selecao: Selecao, cenario?: PedidoCenario): Promise<RespostaComando> {
    return this.comando({ tipo: 'iniciar', idAba, selecao, ...(cenario ? { cenario } : {}) });
  }

  parar(): Promise<RespostaComando> {
    return this.comando({ tipo: 'parar' });
  }

  cancelar(): Promise<RespostaComando> {
    return this.comando({ tipo: 'cancelar' });
  }

  /** Sessão manual com "Memória": tira um heap snapshot agora. */
  tirarSnapshot(): Promise<RespostaComando> {
    return this.comando({ tipo: 'tirar-snapshot' });
  }

  private async comando(comando: ComandoInterface): Promise<RespostaComando> {
    const resposta = await this.ponte.enviar(comando);
    this.pendente = resposta.visao;
    this.limitador.imediato();
    return resposta;
  }

  private receber(visao: VisaoSessao): void {
    // O estado da execução e a iteração também aparecem na hora: o limite de uma
    // publicação por segundo já foi aplicado pelo service worker.
    const mudouDeFase =
      visao.fase !== this.pendente.fase ||
      visao.execucao?.estado !== this.pendente.execucao?.estado ||
      visao.execucao?.iteracao !== this.pendente.execucao?.iteracao;
    this.pendente = visao;
    if (mudouDeFase) this.limitador.imediato();
    else this.limitador.solicitar();
  }
}
