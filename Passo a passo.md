# Passo a passo para colocar o Consultório no ar

O sistema usa 3 serviços. O GitHub guarda os arquivos, o Netlify publica o endereço que a psicóloga abre e o Firebase cuida do login e dos dados. Use as contas empresariais do Firebase e do Netlify.

## 1. Criar o projeto no Firebase

1. Abra console.firebase.google.com com a conta empresarial e clique em "Criar um projeto".
2. Dê o nome sistema-psicologia. Na tela do Google Analytics, desative a opção, porque o sistema não usa.
3. Clique em "Criar projeto" e espere terminar.

## 2. Ativar o login

1. No menu da esquerda, abra "Criação" e depois "Authentication". Clique em "Vamos começar".
2. Na aba "Método de login", escolha "E-mail/senha", ative a primeira chave e salve.
3. Na aba "Usuários", clique em "Adicionar usuário" e cadastre o e-mail da psicóloga com uma senha provisória.
4. Ela pode trocar a senha depois em Configurações, no botão "Receber e-mail para trocar a senha".

## 3. Criar o banco de dados

1. No menu da esquerda, abra "Criação" e depois "Firestore Database". Clique em "Criar banco de dados".
2. Se aparecer a escolha de edição, fique com a Standard.
3. Na localização, escolha southamerica-east1 (São Paulo). Essa escolha não pode ser trocada depois.
4. Escolha "Iniciar no modo de produção" e conclua.
5. Abra a aba "Regras", apague o que estiver lá, cole todo o conteúdo do arquivo firestore.rules e clique em "Publicar".

## 4. Pegar a configuração do aplicativo

1. Clique na engrenagem ao lado de "Visão geral do projeto" e depois em "Configurações do projeto".
2. Em "Seus apps", clique no ícone </> (Web).
3. Dê o apelido Consultório. Não marque o Firebase Hosting. Clique em "Registrar app".
4. Copie o bloco que começa em const firebaseConfig e me mande, ou cole os valores no arquivo firebase-config.js, no lugar de cada COLE_AQUI.

## 5. Subir os arquivos no GitHub

Os arquivos já estão no repositório isabellavfortunato/sistema-psicologia, enviados pelo Claude. As próximas alterações também são enviadas direto para lá.

## 6. Publicar no Netlify

1. Em app.netlify.com, com a conta empresarial, clique em "Add new project" e depois em "Import an existing project".
2. Escolha GitHub, autorize se pedir e selecione o repositório sistema-psicologia.
3. Deixe o "Build command" vazio e escreva um ponto (.) em "Publish directory". Clique em "Deploy".
4. Em "Project configuration", troque o nome do endereço se quiser, por exemplo sistema-psicologia.netlify.app.
5. Volte ao Firebase, em Authentication, aba "Configurações", "Domínios autorizados", e adicione o endereço do Netlify.

A partir daí, toda alteração enviada ao GitHub é publicada sozinha pelo Netlify.

## 7. Cópia de segurança automática (opcional, exige o plano Blaze)

O backup agendado do Firestore só funciona no plano Blaze, que é pago conforme o uso e pede cartão de crédito.

1. No Firebase, clique em "Fazer upgrade" e escolha o plano Blaze. Crie um alerta de orçamento baixo, por exemplo 10 reais por mês, para receber aviso se o custo subir.
2. Abra console.cloud.google.com/firestore/databases com a mesma conta e o mesmo projeto.
3. Na linha do banco (default), na coluna "Scheduled backups", clique em "Edit settings".
4. Clique em "Edit", marque "Daily", escolha o tempo de retenção (o máximo é 14 semanas) e salve.

Sem o plano Blaze, a proteção fica por conta da cópia que a psicóloga baixa em Configurações. O sistema mostra um aviso no Painel quando a última cópia tem 7 dias ou mais.

## 8. Instalar no celular

1. No iPhone, abra o endereço no Safari, toque em compartilhar e depois em "Adicionar à Tela de Início".
2. No Android, abra no Chrome, toque nos 3 pontos e depois em "Instalar app" ou "Adicionar à tela inicial".
