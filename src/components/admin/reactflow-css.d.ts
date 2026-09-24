// React Flow ships a plain stylesheet with no type declaration, and this project's
// tsconfig does not pull in vite/client. Declaring the exact specifier (rather than a
// `*.css` wildcard) keeps this out of the way of any global declaration added later.
declare module 'reactflow/dist/style.css'
