

## Plan: Toggle de visibilidade de senha nas telas de login

Adicionar um botão com ícone de olho nos campos de senha para alternar entre texto visível e oculto.

### Arquivos a editar

1. **`src/pages/AdminLogin.tsx`** — Adicionar estado `showPassword`, trocar `type` entre `password`/`text`, e renderizar botão com ícone `Eye`/`EyeOff` dentro do campo de senha.

2. **`src/components/SapLoginForm.tsx`** — Mesmo padrão para o campo de senha do SAP B1.

### Implementação

- Estado `const [showPassword, setShowPassword] = useState(false)`
- Wrapper `relative` no Input de senha
- Botão absoluto à direita com `Eye` (quando oculto) ou `EyeOff` (quando visível)
- `type={showPassword ? "text" : "password"}`

