// shared/silabizador.js
// Separação silábica automática para palavras em português. Usado pelo
// modo de revelação 'silaba' (ver projectModel.js e CaptionComposition.jsx),
// inspirado na seção "2.2.4 Syllable Variation" do design system Caption
// with Intention: em certos casos, animar sílaba por sílaba comunica
// melhor a cadência da fala do que a palavra inteira de uma vez.
//
// Este é um separador heurístico (não usa dicionário), baseado nas
// regras fonéticas clássicas do português para separação de sílabas:
// cada sílaba tem exatamente um núcleo vocálico (ou ditongo/tritongo),
// e a divisão de consoantes segue os padrões abaixo. Cobre a grande
// maioria dos casos do dia a dia; casos muito irregulares (estrangeirismos,
// siglas) podem não segmentar perfeitamente.

const VOGAIS = 'aeiouáéíóúàâêôãõü';

// Dígrafos consonantais que NUNCA se separam (contam como um único som
// consonantal ao encontrar o início da sílaba seguinte).
const DIGRAFOS_INSEPARAVEIS = ['lh', 'nh', 'ch'];

// Encontros consonantais que também não se separam (formam uma unidade
// no início de sílaba: consoante + l/r formando grupo com o mesmo som).
const ENCONTROS_INSEPARAVEIS = [
  'bl', 'br', 'cl', 'cr', 'dl', 'dr', 'fl', 'fr', 'gl', 'gr',
  'pl', 'pr', 'tl', 'tr', 'vl', 'vr',
];

// Vogais que, em sequência, formam ditongo/tritongo (não se separam).
// Aproximação: qualquer sequência de vogal + i/u átonos (semivogais) ou
// combinações clássicas de ditongo. Não trata hiatos com acento (ex:
// "sa-í-da") de forma exaustiva, mas cobre os casos mais comuns.
const SEMIVOGAIS = ['i', 'u', 'í', 'ú'];

function ehVogal(char) {
  return VOGAIS.includes((char || '').toLowerCase());
}

function ehSemivogalAtona(char) {
  return ['i', 'u'].includes((char || '').toLowerCase());
}

// Verifica se as posições [i, i+1] do texto formam um dígrafo ou encontro
// consonantal inseparável.
function formaGrupoInseparavel(texto, i) {
  if (i + 1 >= texto.length) return false;
  const par = texto.substring(i, i + 2).toLowerCase();
  return DIGRAFOS_INSEPARAVEIS.includes(par) || ENCONTROS_INSEPARAVEIS.includes(par);
}

// Verifica se as posições [i, i+1] formam um ditongo/tritongo (núcleo
// vocálico que não deve ser quebrado entre sílabas).
function formaDitongo(texto, i) {
  if (i + 1 >= texto.length) return false;
  const a = texto[i].toLowerCase();
  const b = texto[i + 1].toLowerCase();
  if (!ehVogal(a) || !ehVogal(b)) return false;
  // Ditongo crescente/decrescente: uma das vogais é semivogal (i/u) e a
  // outra não é também i/u repetida (evita juntar hiatos como "ii").
  if (ehSemivogalAtona(a) || ehSemivogalAtona(b)) return true;
  return false;
}

// Separa uma única palavra em um array de sílabas (strings). Preserva
// maiúsculas/minúsculas e não remove acentos. Palavras sem vogais (ex:
// siglas, números) são devolvidas como sílaba única.
function separarSilabas(palavra) {
  if (!palavra || typeof palavra !== 'string') return [palavra];

  const texto = palavra;
  const n = texto.length;

  // Índices onde cada núcleo vocálico (vogal ou ditongo) começa e termina.
  const nucleos = [];
  let i = 0;
  while (i < n) {
    if (ehVogal(texto[i])) {
      let fim = i;
      // Estende para ditongos/tritongos consecutivos.
      while (fim + 1 < n && formaDitongo(texto, fim)) {
        fim += 1;
      }
      nucleos.push([i, fim]);
      i = fim + 1;
    } else {
      i += 1;
    }
  }

  // Palavra sem vogal identificável: retorna como sílaba única.
  if (nucleos.length === 0) return [texto];

  const silabas = [];
  let inicioSilaba = 0;

  for (let idx = 0; idx < nucleos.length; idx++) {
    const [, fimNucleo] = nucleos[idx];
    const proximoNucleo = nucleos[idx + 1];

    if (!proximoNucleo) {
      // Última sílaba: vai até o fim da palavra (inclui consoantes finais).
      silabas.push(texto.substring(inicioSilaba, n));
      break;
    }

    const [proximoInicio] = proximoNucleo;
    // Consoantes entre o fim deste núcleo e o início do próximo núcleo.
    const consoantesEntre = proximoInicio - (fimNucleo + 1);

    let pontoDeCorte;
    if (consoantesEntre <= 0) {
      // Vogais adjacentes sem consoante entre elas (hiato): corta entre
      // as duas vogais.
      pontoDeCorte = fimNucleo + 1;
    } else if (consoantesEntre === 1) {
      // Uma consoante entre vogais: vai para a sílaba seguinte
      // (padrão CV: "ca-sa", não "cas-a").
      pontoDeCorte = fimNucleo + 1;
    } else {
      // Duas ou mais consoantes entre vogais: verifica se as duas últimas
      // antes do próximo núcleo formam grupo inseparável (dígrafo ou
      // encontro consonantal tipo "br", "tr", "lh"...). Se formarem, o
      // grupo inteiro vai para a sílaba seguinte; senão, corta no meio,
      // deixando a primeira consoante na sílaba atual.
      const posGrupo = proximoInicio - 2;
      if (formaGrupoInseparavel(texto, posGrupo)) {
        pontoDeCorte = posGrupo;
      } else {
        pontoDeCorte = proximoInicio - 1;
      }
    }

    silabas.push(texto.substring(inicioSilaba, pontoDeCorte));
    inicioSilaba = pontoDeCorte;
  }

  return silabas.filter((s) => s.length > 0);
}

// Distribui o intervalo de tempo [inicio, fim] de uma palavra entre suas
// sílabas, proporcionalmente ao número de caracteres de cada uma (mesma
// heurística usada para letras em calcularEstadoNoTempo). Retorna um
// array de objetos { texto, inicio, fim }.
function distribuirTempoPorSilabas(palavra) {
  const { texto, inicio, fim } = palavra;
  const silabas = separarSilabas(texto);
  const totalChars = texto.length;
  const duracao = fim - inicio;

  let acumulado = 0;
  return silabas.map((silaba) => {
    const inicioSilaba = inicio + (acumulado / totalChars) * duracao;
    acumulado += silaba.length;
    const fimSilaba = inicio + (acumulado / totalChars) * duracao;
    return { texto: silaba, inicio: inicioSilaba, fim: fimSilaba };
  });
}

module.exports = {
  separarSilabas,
  distribuirTempoPorSilabas,
};
