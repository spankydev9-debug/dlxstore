export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-4 text-center">
      <p className="text-xs font-semibold tracking-[0.2em] text-primary">DLXSTORE</p>
      <h1 className="mt-4 text-3xl font-bold">Vous êtes hors ligne</h1>
      <p className="mt-3 text-muted-foreground">
        La boutique n’est pas disponible sans connexion. Réessayez dès que le réseau revient — le catalogue et vos commandes se rechargeront automatiquement.
      </p>
    </main>
  );
}
