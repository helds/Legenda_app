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

function separarSilabas(palavra) {
  if (!palavra || typeof palavra !== 'string') return [palavra];
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

export {
  separarSilabas,
  distribuirTempoPorSilabas
};