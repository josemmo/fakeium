import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.strict,
    ...tseslint.configs.stylistic,
    {
        rules: {
            '@typescript-eslint/no-extraneous-class': 'off',
            '@typescript-eslint/no-invalid-void-type': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { caughtErrorsIgnorePattern: '^_' },
            ],
            'no-regex-spaces': 'off',
        },
    },
    {
        ignores: ['dist/*'],
    },
)
