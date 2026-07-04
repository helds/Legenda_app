// shared/silabizador.js
const VOGAIS = 'aeiouáéíóúàâêôãõü';
const DIGRAFOS_INSEPARAVEIS = ['lh', 'nh', 'ch'];
const ENCONTROS_INSEPARAVEIS = [
  'bl', 'br', 'cl', 'cr', 'dl', 'dr', 'fl', 'fr', 'gl', 'gr',
  'pl', 'pr', 'tl', 'tr', 'vl', 'vr',
];
const SEMIVOGAIS = ['i', 'u', 'í', 'ú'];

function ehVogal(char) {
  return VOGAIS.includes((char || '').toLowerCase());
}

function ehSemivogalAtona(char) {
  return ['i', 'u'].includes((char || '').toLowerCase());
}

function formaGrupoInseparavel(texto, i) {
  if (i + 1 >= texto.length) return false;
  const par = texto.substring(i, i + 2).toLowerCase();
  return DIGRAFOS_INSEPARAVEIS.includes(par) || ENCONTROS_INSEPARAVEIS.includes(par);
}

function formaDitongo(texto, i) {
  if (i + 1 >= texto.length) return false;
  const a = texto[i].toLowerCase();
  const b = texto[i + 1].toLowerCase();
  if (!ehVogal(a) || !ehVogal(b)) return false;

  // CORREÇÃO: Identifica ditongos nasais com til para evitar que se separem (ex: ão, ãe, õe)
  const par = a + b;
  if (['ão', 'ãe', 'õe'].includes(par)) return true;

  if (ehSemivogalAtona(a) || ehSemivogalAtona(b)) return true;
  return false;
}

// CORREÇÃO (bugfix preview sumindo): esta função agora SEMPRE retorna um
// array de strings. Antes, quando `palavra` era undefined/null/não-string
// (o que passou a acontecer depois da sincronização de áudio via WhisperX,
// caso alguma palavra alinhada chegasse sem o campo `texto`), o código
// fazia `return [palavra]` — ou seja, um array contendo `undefined`, não
// uma string vazia. Quem consome esse retorno (CaptionComposition.jsx)
// faz `.map(silaba => [...silaba])`, e `[...undefined]` lança
// "TypeError: undefined is not iterable" bem no meio do render do
// Remotion Player. Sem Error Boundary, essa exceção derrubava a árvore
// React inteira — por isso a própria <div> do preview desaparecia, não
// só a legenda.
function separarSilabas(palavra) {
  if (!palavra || typeof palavra !== 'string') return [''];
  const texto = palavra;
  const n = texto.length;
  const nucleos = [];
  let i = 0;

  while (i < n) {
    if (ehVogal(texto[i])) {
      let fim = i;
      while (fim + 1 < n && formaDitongo(texto, fim)) {
        fim += 1;
      }
      nucleos.push([i, fim]);
      i = fim + 1;
    } else {
      i += 1;
    }
  }

  if (nucleos.length === 0) return [texto];

  const silabas = [];
  let inicioSilaba = 0;

  for (let idx = 0; idx < nucleos.length; idx++) {
    const [, fimNucleo] = nucleos[idx];
    const proximoNucleo = nucleos[idx + 1];

    if (!proximoNucleo) {
      silabas.push(texto.substring(inicioSilaba, n));
      break;
    }

    const [proximoInicio] = proximoNucleo;
    const consoantesEntre = proximoInicio - (fimNucleo + 1);

    let pontoDeCorte;
    if (consoantesEntre <= 0) {
      pontoDeCorte = fimNucleo + 1;
    } else if (consoantesEntre === 1) {
      pontoDeCorte = fimNucleo + 1;
    } else {
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

// CORREÇÃO: blindado contra `palavra.texto` ausente/vazio e contra
// `inicio`/`fim` não numéricos (evita NaN se propagando pelo timing).
function distribuirTempoPorSilabas(palavra) {
  const texto = typeof palavra?.texto === 'string' ? palavra.texto : '';
  const inicio = typeof palavra?.inicio === 'number' ? palavra.inicio : 0;
  const fim = typeof palavra?.fim === 'number' ? palavra.fim : inicio;

  const silabas = separarSilabas(texto);
  const totalChars = texto.length || 1;
  const duracao = fim - inicio;

  let acumulado = 0;
  return silabas.map((silaba) => {
    const inicioSilaba = inicio + (acumulado / totalChars) * duracao;
    acumulado += silaba.length;
    const fimSilaba = inicio + (acumulado / totalChars) * duracao;
    return { texto: silaba, inicio: inicioSilaba, fim: fimSilaba };
  });
}

export {
  separarSilabas,
  distribuirTempoPorSilabas
};