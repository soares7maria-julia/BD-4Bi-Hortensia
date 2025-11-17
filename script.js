  //Importa as funções de conexão com o banco
  const { query, testConnection } = require('./database.js');

  //Função principal é assíncrona (pode usar "await" para esperar consultas sem travar o programa)
  async function verificarDependencias() {
  
  // Testa a conexão com o banco
  const conectado = await testConnection(); //Pausa a execução até o teste de conexão terminar
  if (!conectado) {
    console.error("Falha ao conectar no banco. Encerrando execução.");
    process.exit(1); //Encerra imediatamente o programa (1 indica que deu erro)
  }

  //Exibe o nome do programa no console
  console.log(" Descobridor de Dependências Funcionais (DFs) ");

  // Busca automaticamente as tabelas do banco 
   const resultadoTabelas = await query(`
     SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public';
   `); 

  //Pega o nome da primeira tabela do resultado; 'rows' guarda as linhas e '?.' evita erro se estiver vazio
  const nomeTabela = resultadoTabelas.rows[0]?.table_name;
  if (!nomeTabela) {
    console.error("Nenhuma tabela encontrada no banco!"); 
    process.exit(1); //Encerra imediatamente o programa (1 indica que deu erro)
  }

  console.log(`Tabela detectada automaticamente: ${nomeTabela}\n`);

  // Busca os nomes das colunas
  const resultadoColunas = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = '${nomeTabela}';
  `);

  //"rows" guarda as linhas da consulta e "map()" cria uma lista só com os nomes das colunas
  const lista_atributos = resultadoColunas.rows.map(r => r.column_name);
  console.log(`Colunas encontradas: ${lista_atributos.join(', ')}\n`);
  //join(', ') junta os nomes da lista em uma única string, separados por vírgulas

  let vetorA_B = []; //Vetor pra armazenar DFs A->B
  let vetorAB_C = []; //Vetor pra armazenar DFs AB->C
  let vetorABC_D = []; //Vetor pra armazenar DFs ABC->D

  //Aqui começa a verificação de A->B
    console.log("\n-----------------------  A->B ----------------------");

  //Percorre cada coluna como possível lado direito (B)
  for (const lado_direito of lista_atributos) {
    for (const lado_esquerdo of lista_atributos) { //Percorre cada coluna como possível lado esquerdo (A)
      //Se a coluna for igual a ela mesma, ele pula
      if (lado_direito === lado_esquerdo) continue; //Evita comparar coluna com ela mesma

      //Consulta pra verificar se é uma DF A->B
      const sql = `
        SELECT ${lado_esquerdo}
        FROM ${nomeTabela}
        GROUP BY ${lado_esquerdo}
        HAVING COUNT(DISTINCT ${lado_direito}) > 1;
      `; //Verifica se A determina unicamente B

      //Executa a consulta SQL e espera o banco responder antes de continuar
      const resultado = await query(sql);

      if (resultado.rows.length === 0) {
        vetorA_B.push([lado_esquerdo, lado_direito]);
      }
      //Se a consulta não encontrou repetições, adiciona a DF no vetorA_B
    }
  }

  vetorA_B.sort((a, b) => a[0].localeCompare(b[0]));
  //Ordena as dependências funcionais em ordem alfabética com base no lado esquerdo (A)

  //Remove DFs do tipo A->A (redundantes)
  vetorA_B = vetorA_B.filter(([a, b]) => a !== b);

  // Exibe as DFs A->B encontradas + a quantidade delas
  console.log("Dependências funcionais para A->B = " + vetorA_B.length); 
  //Percorre cada dependência A->B no vetor e exibe no console no formato "A->B"
  for (const [a, b] of vetorA_B) {
    console.log(`${a} -> ${b}`);
  }

  //Aqui começa a verificação de AB->C
  console.log("\n-----------------------  AB->C ----------------------");

  //Cria um conjunto que armazena apenas valores únicos, evitando DFs AB->C repetidas
  const setUnicosAB = new Set(); 
  // Set é uma coleção de valores únicos, que não permite repetições

  for (const lado_direito of lista_atributos) { //Lado direito (C)
    for (const lado_esquerdo1 of lista_atributos) { //Primeiro lado esquerdo (A)
      if (lado_direito === lado_esquerdo1) continue; //Evita comparar uma coluna com ela mesma

      for (const lado_esquerdo2 of lista_atributos) { //Segundo atributo do lado esquerdo (B)
        if ([lado_esquerdo1, lado_direito].includes(lado_esquerdo2)) continue;
         //Evita repetir colunas já usadas (não deixa usar a mesma coluna duas vezes)

        //Ordena alfabeticamente (para evitar duplicações invertidas)
        const esquerdoOrdenado = [lado_esquerdo1, lado_esquerdo2].sort();

        //Consulta que verifica se A e B determinam unicamente C
        const sql = `
          SELECT ${esquerdoOrdenado[0]}, ${esquerdoOrdenado[1]}
          FROM ${nomeTabela}
          GROUP BY ${esquerdoOrdenado[0]}, ${esquerdoOrdenado[1]}
          HAVING COUNT(DISTINCT ${lado_direito}) > 1;
        `;

        //Executa a consulta SQL e espera o banco responder antes de continuar
        const resultado = await query(sql);

        //Se não houver repetições no resultado, achou uma dependência funcional nova  
        if (resultado.rows.length === 0) {
          // Cria uma chave única no formato "A,B=>C" para evitar duplicadas
          const chave = `${esquerdoOrdenado.join(',')}=>${lado_direito}`;
          //Se essa DF ainda não foi registrada, adiciona ao conjunto e à lista final 
          if (!setUnicosAB.has(chave)) {
            setUnicosAB.add(chave);
            vetorAB_C.push([esquerdoOrdenado[0], esquerdoOrdenado[1], lado_direito]);
          }
        }
      }
    }
  }

  //Ordena as dependências encontradas (AB -> C) em ordem alfabética 
  vetorAB_C.sort((a, b) => {
    const keyA = a[0] + a[1] + a[2]; //Cria uma chave a partir da dependência "a" com as letras juntas (ex: "ABC")  
    const keyB = b[0] + b[1] + b[2]; // Cria uma "chave" a partir da dependência "b", da mesma forma
    return keyA.localeCompare(keyB); //Compara as chaves em ordem alfabética: ordem das dependências no vetor
  });
  
  //curso, periodo -> periodo
  //Remove casos onde o lado direito (C) já aparece no lado esquerdo (A ou B)
  vetorAB_C = vetorAB_C.filter(([a, b, c]) => ![a, b].includes(c));

  //Exibe as DFs AB->C encontradas + a quantidade delas
  console.log("Dependências funcionais para AB->C = " + vetorAB_C.length);
  //Percorre cada dependência AB->C no vetor e exibe no console no formato "A, B -> C"
  for (const [a, b, c] of vetorAB_C) {
    console.log(`${a}, ${b} -> ${c}`);
  }

  //Aqui começa a verificação de ABC->D
  console.log("\n-----------------------  ABC->D ----------------------");

  //Cria um conjunto que armazena apenas valores únicos, evitando DFs ABC->D repetidas
  const setUnicosABC = new Set();
  //Set é uma coleção de valores únicos, que não permite repetições

  for (const lado_direito of lista_atributos) { //Lado direito (D)
    for (const lado_esquerdo1 of lista_atributos) { //Primeiro lado esquerdo (A)
      if (lado_direito === lado_esquerdo1) continue; //Evita comparar coluna com ela mesma

      for (const lado_esquerdo2 of lista_atributos) { //Segundo lado esquerdo (B)
        if ([lado_esquerdo1, lado_direito].includes(lado_esquerdo2)) continue; 
        // Pula se B for igual a A ou a C (evita repetição)

        for (const lado_esquerdo3 of lista_atributos) { //Terceiro lado esquerdo (C)
          if ([lado_esquerdo1, lado_esquerdo2, lado_direito].includes(lado_esquerdo3)) continue;
          //Pula se C já estiver entre A, B ou for igual a D

          //.sort() ordena os nomes das colunas em ordem alfabética
          const esquerdoOrdenado = [lado_esquerdo1, lado_esquerdo2, lado_esquerdo3].sort();

          //Consulta que verifica se A, B e C determinam unicamente D
          const sql = `
            SELECT ${esquerdoOrdenado.join(', ')}
            FROM ${nomeTabela}
            GROUP BY ${esquerdoOrdenado.join(', ')}
            HAVING COUNT(DISTINCT ${lado_direito}) > 1;
          `; 

          //Executa a consulta SQL e espera o banco responder antes de continuar
          const resultado = await query(sql);

          //Se a consulta SQL não encontrou repetições, significa que A, B e C determinam unicamente D
          if (resultado.rows.length === 0) {
            //Cria uma chave única no formato "A,B,C=>D" para identificar essa dependência
            const chave = `${esquerdoOrdenado.join(',')}=>${lado_direito}`;
             // Verifica se essa DF ainda não foi registrada no conjunto (evita duplicatas)
            if (!setUnicosABC.has(chave)) {
              //Adiciona a chave ao conjunto, garantindo que não haja repetições futuras
              setUnicosABC.add(chave);
              // vetorABC_D armazenará todas as DFs encontradas para exibição posterior
              vetorABC_D.push([...esquerdoOrdenado, lado_direito]);
            }
          }
        }
      }
    }
  }

  //Ordena as dependências funcionais ABC->D em ordem alfabética
  vetorABC_D.sort((a, b) => {
    // Cria uma "chave" para cada dependência, juntando os três atributos do lado esquerdo e o lado direito
    const keyA = a[0] + a[1] + a[2] + a[3];
    const keyB = b[0] + b[1] + b[2] + b[3];
    //Compara as chaves alfabeticamente para definir a ordem final no vetor
    return keyA.localeCompare(keyB);
  });

  //Remove casos onde o lado direito (D) já aparece no lado esquerdo (A, B ou C)
  vetorABC_D = vetorABC_D.filter(([a, b, c, d]) => ![a, b, c].includes(d));

  //Exibe as DFs ABC->D encontradas e a quantidade delas
  console.log("Dependências funcionais para ABC->D = " + vetorABC_D.length);
  //Percorre cada dependência ABC->D no vetor e exibe no console no formato "A, B, C -> D"
  for (const [a, b, c, d] of vetorABC_D) {
    console.log(`${a}, ${b}, ${c} -> ${d}`);
  }

  //Fim das verificações das DFs
  console.log("\n Verificação concluída!");
}

verificarDependencias().catch(err => console.error("Erro geral:", err));
//verificarDependencias() executa a função principal
//.catch(err => ...) trata erros da função assíncrona
//console.error(...) mostra o erro de forma visível no console