import express, { Express, Request, Response } from 'express';

const app: Express = express();
const port: number = 3000;

app.get('/', (req: Request, res: Response) => {
  res.send('Hello, Google Drive Clone Backend!');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});