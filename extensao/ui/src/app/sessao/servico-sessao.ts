import { DestroyRef, Injectable, type Signal, inject, signal } from '@angular/core';
import { criarLimitador } from '../../../../shared/limitador';
import {
  type ComandoInterface,
  INTERVALO_LOTE_MS,
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

  iniciar(idAba: number, selecao: Selecao): Promise<RespostaComando> {
    return this.comando({ tipo: 'iniciar', idAba, selecao });
  }

  parar(): Promise<RespostaComando> {
    return this.comando({ tipo: 'parar' });
  }

  cancelar(): Promise<RespostaComando> {
    return this.comando({ tipo: 'cancelar' });
  }

  private async comando(comando: ComandoInterface): Promise<RespostaComando> {
    const resposta = await this.ponte.enviar(comando);
    this.pendente = resposta.visao;
    this.limitador.imediato();
    return resposta;
  }

  private receber(visao: VisaoSessao): void {
    const mudouDeFase = visao.fase !== this.pendente.fase;
    this.pendente = visao;
    if (mudouDeFase) this.limitador.imediato();
    else this.limitador.solicitar();
  }
}
