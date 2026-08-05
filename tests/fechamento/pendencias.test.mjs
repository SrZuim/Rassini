/* ==========================================================================
   §32 — Testes do MOTOR DE PENDÊNCIAS AUTOMÁTICAS
   `detectar` é puro: recebe os dados da competência e devolve as pendências.
   A sincronização com o banco (idempotência e autocura) é testada pelo
   contrato das chaves, que é o que garante que rodar duas vezes não duplica.
   ========================================================================== */
import { suite, teste, esperar } from '../runner.mjs';
import { detectar } from '../../services/fechamento/fm-pendencias.js';
import { TIPOS_PENDENCIA } from '../../services/fechamento/fm-schema.js';

const COMP = {
  id: 'c1', planta: 'Planta RJ - Lâminas', mes: 8, ano: 2026,
  competencia: '08/2026', data_inicial: '2026-08-01', data_final: '2026-08-31'
};

/* Base COMPLETA: nenhuma pendência deve ser detectada. Serve de linha de base —
   cada teste depois remove uma coisa e verifica que a pendência certa aparece. */
function dadosCompletos(extra = {}) {
  return {
    competencia: COMP,
    /* O lançamento de produção precisa estar COMPLETO: todo campo obrigatório
       do spec gera pendência própria, e é exatamente isso que os testes de
       "campo obrigatório ausente" verificam mais abaixo. */
    producao: [{
      id: 'p1', data: '2026-08-05', planta: 'Planta RJ - Lâminas', linha: 'L1',
      turno: '1º Turno (06:00–14:20)', part_number: 'PN-1',
      qtd_fabricada: 100000, fonte: 'Lançamento manual'
    }],
    fornecimento: [{ id: 'f1', qtd_fornecida: 500000, cliente_oficial: 'Cliente A' }],
    reclamacoes: [], ocorrencias: [], custos: [], care: [], quebras: [],
    seguranca: [], acoes: [],
    metas: ['ppm_externo_oficial', 'ppm_externo_real', 'ppm_interno', 'custo_qualidade']
      .map((ind, i) => ({ id: 'm' + i, indicador: ind, status: 'Ativo', ano: 2026 })),
    ...extra
  };
}
const tipos = p => p.map(x => x.tipo);
const chaves = p => p.map(x => x.chave);

suite('§32 — base completa não gera pendências', () => {
  teste('competência sem lacunas: nenhuma pendência', () => {
    esperar(detectar(dadosCompletos())).tamanho(0);
  });
});

suite('§32 — bases ausentes', () => {
  teste('sem produção gera pendência CRÍTICA e bloqueante', () => {
    const p = detectar(dadosCompletos({ producao: [] }));
    const item = p.find(x => x.tipo === 'producao_ausente');
    esperar(item).naoNulo();
    esperar(item.prioridade).igual('Crítica');
    esperar(item.bloqueia_final).verdadeiro();
    esperar(item.descricao).contem('PPM interno');
  });

  teste('produção com quantidade zero conta como ausente', () => {
    const p = detectar(dadosCompletos({ producao: [{ id: 'p', qtd_fabricada: 0 }] }));
    esperar(tipos(p).includes('producao_ausente')).verdadeiro();
  });

  teste('sem fornecimento gera pendência CRÍTICA e bloqueante', () => {
    const p = detectar(dadosCompletos({ fornecimento: [] }));
    const item = p.find(x => x.tipo === 'fornecimento_ausente');
    esperar(item.bloqueia_final).verdadeiro();
    esperar(item.descricao).contem('PPM externo');
  });

  teste('fornecimento sem cliente oficial gera "cliente não associado"', () => {
    const p = detectar(dadosCompletos({
      fornecimento: [{ id: 'f1', qtd_fornecida: 1000, cliente: 'Empresa X', cliente_oficial: null }]
    }));
    const item = p.find(x => x.tipo === 'cliente_nao_assoc');
    esperar(item).naoNulo();
    esperar(item.bloqueia_final).verdadeiro();
    esperar(item.descricao).contem('Empresa X');
  });
});

suite('§32 — planos de ação 5W2H', () => {
  const plano = (o = {}) => ({
    id: 'a1', status: 'Em andamento', what: 'Revisar dispositivo de solda',
    who: 'João', when_: '2026-12-31', causa_raiz: 'Desgaste do eletrodo', ...o
  });

  teste('plano sem responsável', () => {
    const p = detectar(dadosCompletos({ acoes: [plano({ who: null })] }));
    esperar(tipos(p).includes('plano_sem_resp')).verdadeiro();
  });

  teste('plano sem prazo', () => {
    const p = detectar(dadosCompletos({ acoes: [plano({ when_: null })] }));
    esperar(tipos(p).includes('plano_sem_prazo')).verdadeiro();
  });

  teste('plano sem causa raiz', () => {
    const p = detectar(dadosCompletos({ acoes: [plano({ causa_raiz: null })] }));
    esperar(tipos(p).includes('plano_sem_causa')).verdadeiro();
  });

  teste('ação vencida é CRÍTICA e cita a data', () => {
    const p = detectar(dadosCompletos({ acoes: [plano({ when_: '2026-07-01' })] }), { dataRef: '2026-08-31' });
    const item = p.find(x => x.tipo === 'acao_vencida');
    esperar(item).naoNulo();
    esperar(item.prioridade).igual('Crítica');
    esperar(item.descricao).contem('01/07/2026');
  });

  teste('plano CONCLUÍDO não gera pendência mesmo sem responsável', () => {
    const p = detectar(dadosCompletos({ acoes: [plano({ status: 'Concluído', who: null, when_: '2026-01-01' })] }));
    esperar(p).tamanho(0);
  });

  teste('plano CANCELADO não gera pendência', () => {
    const p = detectar(dadosCompletos({ acoes: [plano({ status: 'Cancelado', who: null })] }));
    esperar(p).tamanho(0);
  });

  teste('plano aguardando evidência sem anexo é cobrado', () => {
    const p = detectar(dadosCompletos({ acoes: [plano({ status: 'Aguardando evidência' })] }));
    esperar(chaves(p).some(c => c.startsWith('plano_sem_evidencia'))).verdadeiro();
  });
});

suite('§32 — quebras, CARE e custos', () => {
  teste('quebra aberta sem RNC', () => {
    const p = detectar(dadosCompletos({
      quebras: [{ id: 'q1', tipo: 'externa', status: 'Em análise', part_number: 'PN-9', rnc_id: null }]
    }));
    const item = p.find(x => x.tipo === 'quebra_sem_rnc');
    esperar(item).naoNulo();
    esperar(item.descricao).contem('PN-9');
  });

  teste('quebra concluída não cobra RNC', () => {
    const p = detectar(dadosCompletos({
      quebras: [{ id: 'q1', tipo: 'externa', status: 'Concluída', rnc_id: null }]
    }));
    esperar(tipos(p).includes('quebra_sem_rnc')).falso();
  });

  teste('CARE com NG sem ocorrência nem plano vinculado', () => {
    const p = detectar(dadosCompletos({
      care: [{ id: 'ca1', data: '2026-08-10', qtd_ng: 5, part_number: 'PN-1' }]
    }));
    esperar(tipos(p).includes('care_sem_tratativa')).verdadeiro();
  });

  teste('CARE sem NG não gera pendência', () => {
    const p = detectar(dadosCompletos({ care: [{ id: 'ca1', qtd_ng: 0 }] }));
    esperar(tipos(p).includes('care_sem_tratativa')).falso();
  });

  teste('CARE com NG e ocorrência vinculada não gera pendência', () => {
    const p = detectar(dadosCompletos({
      care: [{ id: 'ca1', qtd_ng: 5, ocorrencia_id: 'o1' }]
    }));
    esperar(tipos(p).includes('care_sem_tratativa')).falso();
  });

  teste('custo sem documento fiscal (prioridade baixa, não bloqueia)', () => {
    const p = detectar(dadosCompletos({
      custos: [{ id: 'cu1', descricao: 'Frete de retorno', valor: 1200, documento_fiscal: null }]
    }));
    const item = p.find(x => x.tipo === 'custo_sem_doc');
    esperar(item.prioridade).igual('Baixa');
    esperar(item.bloqueia_final).falso();
  });
});

suite('§32 — metas e campos obrigatórios', () => {
  teste('indicador sem meta vigente é cobrado', () => {
    const p = detectar(dadosCompletos({ metas: [] }));
    const itens = p.filter(x => x.tipo === 'indicador_sem_meta');
    esperar(itens).tamanho(4);
  });

  teste('meta de outro ano não conta como vigente', () => {
    const p = detectar(dadosCompletos({
      metas: [{ id: 'm', indicador: 'ppm_interno', status: 'Ativo', ano: 2025 }]
    }));
    esperar(p.filter(x => x.tipo === 'indicador_sem_meta')).tamanho(4);
  });

  teste('campo obrigatório ausente é detectado no lançamento', () => {
    const p = detectar(dadosCompletos({
      ocorrencias: [{ id: 'o1', data: '2026-08-05', origem_ocorrencia: 'Produção',
                      part_number: null, tipo_defeito: 'Rebarba', qtd_pecas: 3 }]
    }));
    const item = p.find(x => x.tipo === 'campo_obrigatorio');
    esperar(item).naoNulo();
    esperar(item.descricao).contem('Part Number');
    esperar(item.registro_id).igual('o1');
  });

  teste('registro completo não gera pendência de campo', () => {
    const p = detectar(dadosCompletos({
      ocorrencias: [{ id: 'o1', data: '2026-08-05', origem_ocorrencia: 'Produção',
                      part_number: 'PN-1', tipo_defeito: 'Rebarba', qtd_pecas: 3 }]
    }));
    esperar(tipos(p).includes('campo_obrigatorio')).falso();
  });
});

suite('§32 — contrato de idempotência', () => {
  teste('chaves são únicas dentro da mesma varredura', () => {
    const p = detectar(dadosCompletos({
      producao: [], fornecimento: [], metas: [],
      acoes: [{ id: 'a1', status: 'Em andamento', who: null, when_: null, causa_raiz: null }],
      quebras: [{ id: 'q1', tipo: 'interna', status: 'Aberta', rnc_id: null }]
    }));
    esperar(new Set(chaves(p)).size).igual(p.length);
  });

  teste('a mesma entrada produz exatamente as mesmas chaves (idempotência)', () => {
    const dados = dadosCompletos({ producao: [], quebras: [{ id: 'q1', tipo: 'interna', status: 'Aberta', rnc_id: null }] });
    esperar(chaves(detectar(dados))).profundo(chaves(detectar(dados)));
  });

  teste('a chave inclui o id do registro, para não colidir entre lançamentos', () => {
    const p = detectar(dadosCompletos({
      quebras: [
        { id: 'q1', tipo: 'interna', status: 'Aberta', rnc_id: null },
        { id: 'q2', tipo: 'externa', status: 'Aberta', rnc_id: null }
      ]
    }));
    esperar(p.filter(x => x.tipo === 'quebra_sem_rnc')).tamanho(2);
    esperar(new Set(chaves(p)).size).igual(p.length);
  });

  teste('todo tipo detectado existe no catálogo do §32', () => {
    const p = detectar(dadosCompletos({
      producao: [], fornecimento: [], metas: [],
      acoes: [{ id: 'a1', status: 'Em andamento', who: null, when_: '2020-01-01', causa_raiz: null }],
      quebras: [{ id: 'q1', tipo: 'interna', status: 'Aberta', rnc_id: null }],
      care: [{ id: 'ca1', qtd_ng: 2 }],
      custos: [{ id: 'cu1', valor: 10, documento_fiscal: null }]
    }));
    for (const t of new Set(tipos(p))) {
      esperar(TIPOS_PENDENCIA[t]).naoNulo(`tipo "${t}" fora do catálogo §32`);
    }
  });

  teste('registro com soft delete não gera pendência', () => {
    const p = detectar(dadosCompletos({
      quebras: [{ id: 'q1', tipo: 'interna', status: 'Aberta', rnc_id: null, deleted_at: '2026-08-20T00:00:00Z' }]
    }));
    esperar(tipos(p).includes('quebra_sem_rnc')).falso();
  });
});
