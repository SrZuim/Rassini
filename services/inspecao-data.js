/* ==========================================================================
   RNA One — Auditorias Dimensionais (dados semente)
   Módulo "Minhas Auditorias" (Operações → inspeção dimensional).
   Tabelas insp_* — configuráveis (tipos e classes editáveis pelo Admin no futuro),
   tabelas de execução iniciam vazias. Persistência via db.js (demo ou Supabase).
   Nada de resultado é fixo: o cálculo (aprovado/reprovado) vem do motor inspecao.js.
   ========================================================================== */

/* ---------------------------------------------------- TIPOS DE INSPEÇÃO (§3)
   is_dimensional = exige tabela de medições/cálculo dimensional.
   Estrutura permite futuro CRUD pelo Admin (ativar/desativar, novos tipos,
   marcar quais usam medição, vincular modelo de relatório, campos obrigatórios). */
export const INSP_TIPOS_DEFAULT = [
  { id:'it1', slug:'vda65',        nome:'Auditoria VDA 6.5',                                  is_dimensional:true,  ordem:1, ativo:true },
  { id:'it2', slug:'layout',       nome:'Inspeção de Layout',                                 is_dimensional:true,  ordem:2, ativo:true },
  { id:'it3', slug:'final',        nome:'Inspeção Final',                                     is_dimensional:true,  ordem:3, ativo:true },
  { id:'it4', slug:'ppap',         nome:'PPAP — Processo de Aprovação de Peça de Produção',   is_dimensional:true,  ordem:4, ativo:true },
  { id:'it5', slug:'durabilidade', nome:'Relatório para Durabilidade',                        is_dimensional:true,  ordem:5, ativo:true },
  { id:'it6', slug:'ride',         nome:'Relatório para Ride',                                is_dimensional:true,  ordem:6, ativo:true },
  { id:'it7', slug:'fisico_dim',   nome:'Teste Físico e Dimensional',                         is_dimensional:true,  ordem:7, ativo:true }
];

/* ----------------------------------------------- CLASSES DE DEFEITO (§13-15)
   Definição, gravidade, critérios, ações e obrigatoriedades por classe.
   `obrig` = campos obrigatórios ao selecionar a classe (config, §13.Regras..§15.Regras).
   `gera_pendencia`: 'obrigatoria' | 'opcional' | 'justificar' — usado no tratamento. */
export const INSP_CLASSES_DEFAULT = [
  {
    id:'clsA', codigo:'A', nome:'Classe A', ordem:1, ativo:true,
    gravidade:'Não conformidade grave',
    cor:'red',
    definicao:'Não conformidade grave, pois a ocorrência pode levar a uma não conformidade no cliente.',
    criterios:[
      'Risco à segurança','Risco relacionado à legislação','Possibilidade de imobilizar o veículo',
      'Produto não vendável','Função não cumprida','Não conformidades externas na superfície',
      'Condição crítica que afete o produto ou o cliente'
    ],
    acoes_imediatas:[
      'Segregar as peças para a área de não conformidade','Notificar o cliente conforme o procedimento de comunicação',
      'Abrir relatório ou formulário de ação corretiva','Iniciar investigação da causa raiz',
      'Garantir entrega somente de produtos aprovados','Aplicar a metodologia prevista na auditoria ou no procedimento',
      'Registrar envio de peças sob desvio, quando necessário','Registrar a aprovação do cliente','Registrar outras ações acordadas'
    ],
    acoes_permanentes:[
      'Continuar a análise do processo e dos controles','Elaborar e executar ações corretivas',
      'Registrar relatório de ação corretiva','Controlar a eficácia das ações','Definir responsável','Definir prazo',
      'Anexar evidências','Acompanhar a conclusão'
    ],
    obrig:{ observacao:true, acao_imediata:true, responsavel:true, prazo:true, evidencia:true },
    gera_pendencia:'obrigatoria'
  },
  {
    id:'clsB', codigo:'B', nome:'Classe B', ordem:2, ativo:true,
    gravidade:'Não conformidade moderada',
    cor:'orange',
    definicao:'Não conformidade moderada, pois pode gerar aborrecimentos ou reclamações do cliente.',
    criterios:[
      'Deficiência prevista','Redução da utilidade','Redução da capacidade','Falha funcional moderada',
      'Condição que possa gerar reclamação','Problema sem risco imediato de segurança, mas que afete a utilização ou percepção do cliente'
    ],
    acoes_imediatas:[
      'Segregar as peças para a área de não conformidade','Notificar o cliente quando aplicável',
      'Abrir relatório de ação corretiva','Investigar a causa raiz','Garantir entrega somente de produtos aprovados',
      'Aplicar a metodologia definida pelo processo','Registrar envio sob desvio, quando necessário',
      'Registrar aprovação do cliente','Registrar ações adicionais'
    ],
    acoes_permanentes:[
      'Analisar as atividades do processo','Elaborar e executar correções','Controlar a eficácia',
      'Registrar responsável','Registrar prazo','Anexar evidências','Acompanhar a conclusão'
    ],
    obrig:{ observacao:true, acao_imediata:true, responsavel:true, prazo:false, evidencia:false },
    gera_pendencia:'justificar'
  },
  {
    id:'clsC', codigo:'C', nome:'Classe C', ordem:3, ativo:true,
    gravidade:'Não conformidade leve',
    cor:'yellow',
    definicao:'Não conformidade leve, pois nem todos os clientes conseguem perceber ou notar o problema.',
    criterios:[
      'Desvios que não influenciam o uso','Desvios que não influenciam a operação','Baixa percepção pelo cliente',
      'Utilidade do produto não reduzida','Condição visual ou dimensional de baixa criticidade','Função principal preservada'
    ],
    acoes_imediatas:[
      'Segregar o lote na área de reinspeção','Separar os produtos passíveis de envio','Verificar a necessidade de reinspeção',
      'Informar a planta recebedora caso o problema ultrapasse as fronteiras da organização','Registrar as ações acordadas','Anexar evidências'
    ],
    acoes_permanentes:[
      'Não há ação de correção permanente obrigatória definida. Opcionalmente: ação preventiva, ação de melhoria, análise de tendência, observação, acompanhamento ou ação corretiva caso exista recorrência.'
    ],
    obrig:{ observacao:true, acao_imediata:false, responsavel:false, prazo:false, evidencia:false, segregacao:true },
    gera_pendencia:'opcional'
  }
];

/* ------------------------------------------------------- QUANTIDADE DE PEÇAS (§6) */
export const INSP_QUANTIDADES = [1, 2, 3, 4, 5];

/* ------------------------------------------------ STATUS DO RELATÓRIO (§26) */
export const INSP_STATUS = {
  rascunho:            { label:'Não iniciada',            badge:'badge-na' },
  em_andamento:        { label:'Em andamento',            badge:'badge-info' },
  aguardando:          { label:'Aguardando preenchimento',badge:'badge-pend' },
  finalizada_aprovada: { label:'Finalizada — Aprovada',   badge:'badge-ok' },
  finalizada_reprovada:{ label:'Finalizada — Reprovada',  badge:'badge-crit' },
  revisada:            { label:'Revisada',                badge:'badge-warn' },
  cancelada:           { label:'Cancelada',               badge:'badge-na' },
  arquivada:           { label:'Arquivada',               badge:'badge-na' }
};

/* Motivos de pausa (§46) */
export const INSP_MOTIVOS_PAUSA = [
  'Intervalo','Aguardando peça','Aguardando equipamento','Aguardando informação',
  'Equipamento indisponível','Suporte do supervisor','Troca de atividade','Outro'
];

/* Mapa nome→sigla de planta para a numeração do relatório (§25). */
export const PLANTA_SIGLAS = {
  'Planta Rio Nova Iguaçu':'RIO',
  'Planta São Bernardo':'SBC',
  'Planta SP 01':'SP1',
  'Planta SP 02':'SP2',
  'Planta Jarinu':'JAR'
};

/* ------------------------------------------------------- semente do banco -- */
export const INSPECAO = {
  insp_tipos:          INSP_TIPOS_DEFAULT,
  insp_classes:        INSP_CLASSES_DEFAULT,
  insp_relatorios:     [],
  insp_caracteristicas:[],
  insp_medicoes:       [],
  insp_amostras:       [],   // §M04 — posse/tempo/resultado por peça (colaborativo)
  insp_acoes:          [],
  insp_anexos:         [],
  insp_historico:      [],
  insp_eventos:        [],          // fluxo de eventos p/ o Monitoramento (§67)
  insp_seq:            [],          // contadores sequenciais por chave TIPO-PLANTA-ANO
  insp_pausas:         [],          // registro de pausas (§46)
  insp_monitor_logs:   [],          // logs de acesso ao Monitoramento (§64)
  insp_alertas:        []           // alertas operacionais (§53) — gerados sob demanda
};

/* Limiares padrão dos alertas (§53) — configuráveis pelo admin no futuro. */
export const INSP_ALERT_LIMIARES = {
  inatividade_min: 20,          // sem interação relevante há > N min
  acima_esperado_pct: 40,       // tempo > N% do esperado
  rapido_demais_seg: 60,        // finalizada com < N segundos por característica
  alteracoes_medicao: 3         // > N alterações na mesma medição
};

/* Rótulos dos tipos de evento (§67) para a linha do tempo (§56). */
export const INSP_EVENTO_LABEL = {
  shift_started:'Plantão iniciado', shift_completed:'Plantão finalizado',
  inspection_created:'Inspeção criada', inspection_started:'Inspeção iniciada',
  inspection_paused:'Inspeção pausada', inspection_resumed:'Inspeção retomada',
  inspection_abandoned:'Inspeção abandonada', inspection_completed:'Inspeção finalizada',
  part_selected:'Peça selecionada', sample_started:'Amostra iniciada', sample_completed:'Amostra concluída',
  characteristic_opened:'Característica aberta', measurement_created:'Medição registrada',
  measurement_updated:'Medição alterada', measurement_rejected:'Medição reprovada',
  defect_classified:'Defeito classificado', attachment_uploaded:'Evidência anexada',
  corrective_action_created:'Ação/pendência criada', review_started:'Revisão iniciada',
  review_completed:'Revisão concluída', report_generated:'Relatório gerado',
  report_printed:'Relatório impresso', report_exported:'Relatório exportado',
  report_reopened:'Relatório reaberto', report_corrected:'Relatório corrigido',
  save:'Alteração salva', save_failed:'Falha ao salvar',
  connection_lost:'Conexão perdida', connection_restored:'Conexão restaurada'
};
