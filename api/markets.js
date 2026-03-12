export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://gamma-api.polymarket.com/markets?active=true&limit=100"
    );

    const data = await response.json();

    res.status(200).json(data);

  } catch (error) {
    res.status(500).json({
      error: "Erro ao buscar dados da API Polymarket",
      details: error.message
    });
  }
}
