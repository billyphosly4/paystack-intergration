# paystack-intergration

A simple Paystack checkout integration using HTML, CSS, Vanilla JavaScript, and Node.js/Express.

## Vercel Deployment

1. Set your environment variables in the Vercel dashboard:
   - `PAYSTACK_PUBLIC_KEY`
   - `PAYSTACK_SECRET_KEY`
   - `PORT` (optional, default `3000`)

2. Deploy the project by connecting the repository to Vercel or running:
   `vercel`

3. Confirm the `/pay-paystack` and `/verify-payment/:reference` API routes work on the deployed site.

## Local Development

- Install dependencies: `npm install`
- Run locally: `npm start`

## Notes

- `.env` is ignored via `.gitignore`; do not commit secrets.
- The app uses `server.js` as a Vercel serverless function and `vercel.json` for route configuration.
