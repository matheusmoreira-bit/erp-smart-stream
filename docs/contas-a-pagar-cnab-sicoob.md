# Contas a Pagar - CNAB 240 Sicoob

## Escopo

O módulo `/financeiro/contas-a-pagar` consulta diretamente o SAP Business One e apresenta NFs de entrada (`PurchaseInvoices`) abertas e com saldo. A primeira versão cobre pagamentos de boletos em BRL pelo padrão CNAB 240 do Sicoob.

O fluxo possui duas etapas:

1. Seleção dos títulos, informação do código de barras e geração da remessa `.REM`.
2. Importação do arquivo `.RET`, conferência das ocorrências e criação do pagamento a fornecedor (`VendorPayments`) no SAP.

Pagamentos via Pix, tributos, moedas estrangeiras e outros bancos não fazem parte desta versão.

## Componentes

- Página: `src/pages/AccountsPayable.tsx`
- Edge Function: `supabase/functions/accounts-payable-cnab/index.ts`
- Gerador e parser: `supabase/functions/_shared/sicoob-cnab240.ts`
- Banco: `supabase/migrations/20260901160000_accounts_payable_cnab.sql`
- Testes: `src/lib/sicoob-cnab240.test.ts`

## Regras de negócio

- O saldo é relido no SAP antes da geração da remessa.
- Somente documentos abertos, não cancelados, com saldo positivo e em BRL podem ser enviados.
- Um título com remessa ativa não volta à lista até ser rejeitado ou concluído.
- Cada arquivo recebe um NSA reservado de forma atômica por empresa.
- O código de barras deve conter exatamente 44 dígitos.
- A referência do ERP Flow no Segmento J identifica o título no retorno.
- Somente a ocorrência `00` é interpretada como pagamento efetivado.
- Ocorrências `BD` e `PD` são tratadas como agendamento e não geram baixa no SAP.
- O retorno é processado de forma idempotente: arquivos repetidos, títulos já baixados e execuções concorrentes não criam um segundo `VendorPayment`.
- Se o título já estiver fechado no SAP, o evento é marcado como já liquidado e nenhuma baixa adicional é criada.

## Configuração por empresa

Na tela, abra **Configuração Sicoob** e informe:

- Razão social e CPF/CNPJ do pagador.
- Código do convênio Sicoob.
- Agência, conta e respectivos dígitos.
- Conta contábil SAP usada como contrapartida da transferência.

Os dados ficam em `accounts_payable_bank_accounts` e só podem ser lidos ou alterados pela Edge Function com `service_role`.

## Implantação

1. Aplicar a migration `20260901160000_accounts_payable_cnab.sql`.
2. Publicar a função `accounts-payable-cnab`.
3. Confirmar credenciais `Apiuser` do SAP para cada empresa.
4. Configurar a conta Sicoob na nova tela.
5. Gerar um arquivo de teste e homologá-lo com o banco antes da primeira remessa real.

## Segurança e auditoria

- A função exige acesso administrativo ou permissão no módulo `financial_review`.
- A empresa da requisição deve ser a mesma empresa da sessão autenticada.
- As tabelas possuem RLS e política exclusiva para `service_role`.
- Hashes SHA-256 identificam remessas e retornos.
- Lotes, títulos, ocorrências bancárias, erros e documentos de pagamento SAP ficam persistidos para auditoria.

## Referências do layout

- [Guia de importação CNAB 240 do Sicoob](https://www.sicoob.com.br/documents/20128/1635942/Guia%2Bde%2Bimportacao%2Bde%2Barquivos%2BCNAB%2B240%2BPiloto.pdf/53ce530c-54ee-7952-32fb-3e5f2f2a57a9?download=true&t=1747666535910&version=2.0)
- [Layout CNAB 240 FEBRABAN](https://portal.febraban.org.br/pagina/3053/33/pt-br/layout-240?class_id=5883_1_828)
